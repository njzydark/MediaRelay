import styles from "./index.module.less";
import { Dialog as RawDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../button/index.tsx";

const { Root, Trigger, Portal, Backdrop, Popup, Title, Description, Close, Viewport } = RawDialog;

type Props = {
  title?: ReactNode;
  desc?: ReactNode;
  content?: ReactNode;
  children: ReactElement;
  hideFooter?: boolean;
  showCloseIcon?: boolean;
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
};

export const Dialog = (
  { children, title, desc, content, hideFooter, showCloseIcon = true, footer, onOpenChange }: Props,
) => {
  return (
    <Root onOpenChange={onOpenChange}>
      <Trigger render={children} />
      <Portal>
        <Backdrop className={styles.Backdrop} />
        <Viewport>
          <Popup className={styles.Popup}>
            {(title || showCloseIcon) && (
              <div className={styles.Header}>
                {title && (
                  <div className={styles.TitleWrapper}>
                    <Title className={styles.Title}>{title}</Title>
                  </div>
                )}
                {showCloseIcon && (
                  <Close className={styles.CloseIcon}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </Close>
                )}
              </div>
            )}
            {desc && (
              <Description className={styles.Description}>
                {desc}
              </Description>
            )}
            {content && (
              <div className={styles.Content}>
                {content}
              </div>
            )}
            {!hideFooter && (
              <div className={styles.Footer}>
                {footer ?? <Close render={<Button>Close</Button>} />}
              </div>
            )}
          </Popup>
        </Viewport>
      </Portal>
    </Root>
  );
};
