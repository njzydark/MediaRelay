import styles from "./index.module.less";
import { Button as RawButton } from "@base-ui/react/button";
import type { MouseEventHandler, ReactNode } from "react";

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Props = {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  title?: string;
  className?: string;
  icon?: boolean;
  primay?: boolean;
  borderless?: boolean;
  variant?: "default" | "primary";
  size?: "small" | "medium";
};

export const Button = ({
  children,
  onClick,
  disabled,
  primay,
  borderless,
  className,
  title,
  variant = "default",
  size = "medium",
}: Props) => {
  return (
    <RawButton
      className={cn(
        styles.Button,
        primay && styles.Primary,
        borderless && styles.Borderless,
        variant === "primary" && styles.Primary,
        size === "small" && styles.Small,
        className,
      )}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </RawButton>
  );
};
