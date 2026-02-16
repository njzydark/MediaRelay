import styles from "./index.module.less";
import { RadioGroup as RawRadioGroup } from "@base-ui/react/radio-group";
import { Radio as RawRadio } from "@base-ui/react/radio";
import type { ReactNode } from "react";

type Option = {
  value: string;
  label: ReactNode;
};

type Props = {
  value?: string;
  onChange?: (value: string) => void;
  options: Option[];
  disabled?: boolean;
};

export const RadioGroup = ({ value, onChange, options, disabled }: Props) => {
  return (
    <RawRadioGroup
      className={styles.RadioGroup}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.RadioLabel}>
          <RawRadio.Root value={option.value} className={styles.Radio}>
            <RawRadio.Indicator className={styles.RadioIndicator} />
          </RawRadio.Root>
          {option.label}
        </label>
      ))}
    </RawRadioGroup>
  );
};
