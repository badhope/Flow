import { Injectable, Logger } from '@nestjs/common';
import { isSafePublicHttpUrl } from '../../common/http/url-guard';

export type NotifyKind = 'webhook' | 'email' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

export interface NotifyConfig {
  kind: NotifyKind;
  /** Webhook 地址（飞书/企微/钉钉/Slack） */
  url?: string;
  /** SMTP 配置（kind=email 时必填） */
  smtp?: SmtpConfig;
}

export interface NotifyResult {
  ok: boolean;
  channel: NotifyKind;
  message: string;
  attempts?: number;
  /** 配置无效（不重试） */
  permanent?: boolean;
}

/**
 * 通知发送原语：把"具体怎么发"与"重试/熔断策略"分开。
 * - webhook：POST JSON {text, msgtype, content:{text}}
 * - email：nodemailer（零运行时依赖，1.7MB）
 * 本类不重试、不抛异常，只如实返回失败原因与是否可重试。
 */
@Injectable()
export class NotifyTransport {
  private readonly logger = new Logger(NotifyTransport.name);
  /** 惰性加载，避免未配置邮件时也引入 nodemailer */
  private nodemailer: typeof import('nodemailer') | null = null;

  async deliver(config: NotifyConfig, subject: string, text: string, html?: string): Promise<NotifyResult> {
    if (config.kind === 'none') {
      return { ok: false, channel: 'none', message: '未配置通知渠道', permanent: true };
    }
    if (config.kind === 'webhook') return this.sendWebhook(config.url, text);
    return this.sendEmail(config.smtp, subject, text, html);
  }

  private async sendWebhook(url: string | undefined, text: string): Promise<NotifyResult> {
    if (!url) {
      return { ok: false, channel: 'webhook', message: '未配置 Webhook 地址', permanent: true };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, channel: 'webhook', message: 'Webhook 地址必须以 http(s):// 开头', permanent: true };
    }
    // 与巡检设置同一策略：生产拦截内网地址；开发放行（本地 mock / 局域网 webhook 合法）
    if (process.env.NODE_ENV === 'production' && !isSafePublicHttpUrl(url)) {
      let safeHost = 'invalid';
      try { safeHost = new URL(url).hostname; } catch { /* validation already failed */ }
      this.logger.warn(`Webhook 地址被拒绝（私网/保留地址）: host=${safeHost}`);
      return {
        ok: false,
        channel: 'webhook',
        message: 'Webhook 地址不可用：禁止指向内网/保留地址（SSRF 防护）',
        permanent: true,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, msgtype: 'text', content: { text } }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            ok: false,
            channel: 'webhook',
            message: `Webhook 返回 HTTP ${response.status}`,
            permanent: !(response.status >= 500 || response.status === 429),
          };
        }
        return { ok: true, channel: 'webhook', message: '通知已发送' };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Webhook 发送失败：${message}`);
      return { ok: false, channel: 'webhook', message: `发送失败：${message}`, permanent: false };
    }
  }

  private async sendEmail(
    smtp: SmtpConfig | undefined,
    subject: string,
    text: string,
    html?: string,
  ): Promise<NotifyResult> {
    if (!smtp?.host || !smtp.from || !smtp.to) {
      return { ok: false, channel: 'email', message: 'SMTP 配置不完整（需 host/from/to）', permanent: true };
    }

    try {
      if (!this.nodemailer) {
        this.nodemailer = await import('nodemailer');
      }
      const transporter = this.nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        // 邮件服务器握手/发送不应拖住巡检
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });

      await transporter.sendMail({
        from: smtp.from,
        to: smtp.to,
        subject,
        text,
        ...(html ? { html } : {}),
      });
      return { ok: true, channel: 'email', message: '邮件已发送' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`邮件发送失败：${message}`);
      // 认证/配置类错误（EAUTH/EENVELOPE）不重试
      const permanent = /EAUTH|EENVELOPE|Invalid login|authentication/i.test(message);
      return { ok: false, channel: 'email', message: `发送失败：${message}`, permanent };
    }
  }
}
