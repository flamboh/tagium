import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DestructiveActionDialogBaseProps {
  open: boolean;
  returnFocusTarget: HTMLButtonElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export type DestructiveActionDialogProps = DestructiveActionDialogBaseProps &
  (
    | { kind: "remove-tracks"; itemCount: number }
    | { kind: "delete-album"; albumTitle: string; trackCount: number }
  );

export default function DestructiveActionDialog(props: DestructiveActionDialogProps) {
  const { open, returnFocusTarget, onCancel, onConfirm } = props;
  const copy =
    props.kind === "remove-tracks"
      ? {
          title: `remove ${props.itemCount !== 1 ? `${props.itemCount} tracks` : "track"}?`,
          description: `this removes the ${props.itemCount === 1 ? "track" : "tracks"} from the current session. this cannot be undone.`,
          cancelLabel: `keep ${props.itemCount === 1 ? "track" : "tracks"}`,
          confirmLabel: `remove ${props.itemCount === 1 ? "track" : "tracks"}`,
        }
      : {
          title: `delete ${props.albumTitle}?`,
          description: `this deletes the album${
            props.trackCount === 0
              ? ""
              : props.trackCount === 1
                ? " and its track"
                : ` and all ${props.trackCount} tracks`
          } from the current session. this cannot be undone.`,
          cancelLabel: "keep album",
          confirmLabel: "delete album",
        };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTarget?.isConnected) return;
          event.preventDefault();
          returnFocusTarget.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {copy.cancelLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
