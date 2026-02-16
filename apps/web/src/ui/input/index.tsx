import styles from "./index.module.less";
import { Input as RawInput } from "@base-ui/react/input";
import { type ChangeEvent, type ReactNode, useState } from "react";

// Eye Icon (show password)
const EyeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

// Eye Off Icon (hide password)
const EyeOffIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24">
    </path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
);

type Props = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "url" | "number";
  label?: ReactNode;
  disabled?: boolean;
  suffix?: string;
  className?: string;
  size?: "small" | "medium";
};

export const Input = (
  { value, onChange, placeholder, type = "text", label, disabled, suffix, className, size = "medium" }: Props,
) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value);
  };

  return (
    <label className={`${styles.Label} ${className || ""}`}>
      {label && <span className={styles.LabelText}>{label}</span>}
      <div className={`${styles.InputWrapper} ${suffix ? styles.WithSuffix : ""}`}>
        <RawInput
          className={`${styles.Input} ${size === "small" ? styles.Small : ""} ${
            isPassword ? styles.InputWithToggle : ""
          } ${suffix ? styles.InputWithSuffix : ""}`}
          type={inputType}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
        />
        {suffix && <span className={styles.Suffix}>{suffix}</span>}
        {isPassword && (
          <button
            type="button"
            className={styles.ToggleButton}
            onClick={() => setShowPassword(!showPassword)}
            disabled={disabled}
            title={showPassword ? "Hide" : "Show"}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </label>
  );
};
