import { useEffect, useId, useRef, type ReactNode } from 'react';
export function Modal({
  open,
  title,
  close,
  busy,
  children,
}: {
  open: boolean;
  title: string;
  close: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
      onClose={() => {
        if (open) close();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
