import type { ReactNode } from "react";
import { AlertIcon } from "../icon/index.tsx";
import styles from "./index.module.less";

type Props = {
  content: ReactNode;
};

export const Alert = ({ content }: Props) => {
  return (
    <div className={styles.HelpText}>
      <AlertIcon className={styles.AlertIcon} />
      <span>
        {content}
      </span>
    </div>
  );
};
