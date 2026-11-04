import { Module } from '@nestjs/common';
import { CopilotModule } from '../copilot/copilot.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [CopilotModule],
  controllers: [McpController],
})
export class McpModule {}
