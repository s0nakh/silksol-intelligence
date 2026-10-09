import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
        primary: "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
        destructive: "bg-warning text-background hover:bg-warning/90",
        outline:
          "border border-border bg-secondary text-secondary-foreground hover:border-primary/40 hover:bg-accent",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:border-primary/40 hover:bg-accent",
        ghost: "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        icon: "border border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);

Button.displayName = "Button";
