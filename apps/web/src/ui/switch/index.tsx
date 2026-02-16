import styles from "./index.module.less";
import type { ChangeEvent, ReactNode } from "react";
import classNames from "classnames";

type Props = {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "small" | "medium";
  className?: string;
};

export const Switch = ({ checked, onCheckedChange, label, disabled, size = "medium", className }: Props) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onCheckedChange?.(e.target.checked);
  };

  return (
    <label className={classNames(styles.Label, className)}>
      {label && <span className={styles.LabelText}>{label}</span>}
      <span className={classNames(styles.SwitchWrapper, size === "small" && styles.Small)}>
        <input
          type="checkbox"
          className={styles.Input}
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
        />
        <span className={styles.Track} data-checked={checked}>
          <span className={styles.Thumb} />
        </span>
      </span>
    </label>
  );
};
