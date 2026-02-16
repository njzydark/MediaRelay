import { Select as RawSelect } from "@base-ui/react/select";
import styles from "./index.module.less";
import { CheckIcon, ChevronUpDownIcon } from "@/components/icon/index.tsx";
import classNames from "classnames";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string | null) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: "small" | "medium";
  className?: string;
}

export const Select = ({ value, onChange, options, placeholder, size = "medium", className }: SelectProps) => {
  return (
    <RawSelect.Root items={options} value={value} onValueChange={onChange}>
      <RawSelect.Trigger className={classNames(styles.Select, size === "small" && styles.Small, className)}>
        <RawSelect.Value className={styles.Value} placeholder={placeholder} />
        <RawSelect.Icon className={styles.SelectIcon}>
          <ChevronUpDownIcon />
        </RawSelect.Icon>
      </RawSelect.Trigger>
      <RawSelect.Portal>
        <RawSelect.Positioner className={styles.Positioner} sideOffset={8}>
          <RawSelect.Popup className={styles.Popup}>
            <RawSelect.ScrollUpArrow className={styles.ScrollArrow} />
            <RawSelect.List className={styles.List}>
              {options.map(({ label, value }) => (
                <RawSelect.Item key={label} value={value} className={styles.Item}>
                  <RawSelect.ItemIndicator className={styles.ItemIndicator}>
                    <CheckIcon />
                  </RawSelect.ItemIndicator>
                  <RawSelect.ItemText className={styles.ItemText}>{label}</RawSelect.ItemText>
                </RawSelect.Item>
              ))}
            </RawSelect.List>
            <RawSelect.ScrollDownArrow className={styles.ScrollArrow} />
          </RawSelect.Popup>
        </RawSelect.Positioner>
      </RawSelect.Portal>
    </RawSelect.Root>
  );
};
