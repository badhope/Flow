"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Switch with a 24px-tall hit area and a compact visual track.
 *
 * The Radix root is a transparent 32x24 button; the visible pill is drawn by
 * the `::before` layer so the control meets the WCAG 2.2 target size rule while
 * keeping the original 32x18 look. The thumb is positioned inside that pill.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-8 shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-1/2 before:h-[18px] before:-translate-y-1/2 before:rounded-full before:border before:border-transparent before:transition-colors",
        "data-[state=unchecked]:before:bg-input data-[state=checked]:before:bg-primary",
        "focus-visible:ring-[3px] focus-visible:ring-ring/25",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "relative z-10 ml-[2px] block size-4 rounded-full bg-background ring-0 transition-transform",
          "data-[state=checked]:translate-x-[10px] data-[state=unchecked]:translate-x-0",
          "dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground data-disabled:opacity-60"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
