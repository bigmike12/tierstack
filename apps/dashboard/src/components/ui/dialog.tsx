"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * A trigger that opens a native <dialog> instead of submitting immediately;
 * the dialog's own submit button is what actually fires the form action, so
 * this only works nested inside the <form> it should confirm.
 *
 * <dialog> is used deliberately over a hand-built modal: showModal() gives a
 * real top-layer render, focus trap, Escape-to-close and a ::backdrop for
 * free, so nothing here has to reimplement them.
 */
export function ConfirmSubmitButton({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  children,
  variant,
  ...triggerProps
}: Omit<ButtonProps, "type" | "onClick"> & {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  return (
    <>
      <Button type="button" variant={variant} {...triggerProps} onClick={() => dialogRef.current?.showModal()}>
        {children}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:transition-opacity"
        onClick={(event) => {
          // A click on the <dialog> element itself (not its content) is a
          // click on the backdrop area — dismiss the way an overlay click
          // dismisses any other modal.
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        onCancel={() => dialogRef.current?.close()}
      >
        <div className="p-5">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <p id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => dialogRef.current?.close()}>
            {cancelLabel}
          </Button>
          <ConfirmAction
            label={confirmLabel}
            variant={variant === "destructive" ? "destructive" : "default"}
            onConfirmed={() => dialogRef.current?.close()}
          />
        </div>
      </dialog>
    </>
  );
}

/**
 * The dialog's real submit button. Split out only so it can read the
 * enclosing form's pending state independently of the trigger button, which
 * sits outside the <dialog> and would otherwise never re-render.
 */
function ConfirmAction({
  label,
  variant,
  onConfirmed,
}: {
  label: string;
  variant: ButtonProps["variant"];
  onConfirmed: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending} onClick={onConfirmed}>
      {pending ? "Working…" : label}
    </Button>
  );
}
