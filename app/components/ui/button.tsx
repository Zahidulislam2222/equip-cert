import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg active:scale-[0.98]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md",
        outline: "border-2 border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Industrial variants
        industrial: "gradient-industrial text-primary-foreground shadow-industrial hover:shadow-xl active:scale-[0.98]",
        success: "bg-success text-success-foreground shadow-md hover:shadow-lg active:scale-[0.98]",
        warning: "bg-warning text-warning-foreground shadow-md hover:shadow-lg active:scale-[0.98]",
        // Touch-friendly variants for mobile
        touch: "bg-primary text-primary-foreground min-h-[56px] px-8 text-lg rounded-xl shadow-lg hover:shadow-xl active:scale-[0.97]",
        "touch-success": "bg-success text-success-foreground min-h-[56px] px-6 text-base font-bold rounded-xl shadow-lg active:scale-[0.97]",
        "touch-fail": "bg-destructive text-destructive-foreground min-h-[56px] px-6 text-base font-bold rounded-xl shadow-lg active:scale-[0.97]",
        "touch-outline": "border-2 border-muted-foreground/30 bg-background text-foreground min-h-[56px] px-6 text-base rounded-xl active:scale-[0.97]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-12 rounded-lg px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg",
        icon: "h-10 w-10",
        "icon-lg": "h-12 w-12",
        touch: "h-14 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
