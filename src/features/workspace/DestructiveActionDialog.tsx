import { useGT } from "gt-react";
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

  const gt = useGT();

  const copy =
    props.kind === "remove-tracks"
      ? {
          title: gt("{count, plural, one {remove track?} other {remove # tracks?}}", {
            count: props.itemCount,
          }),
          description: gt(
            "{count, plural, one {this removes the track from the current session. this cannot be undone.} other {this removes the tracks from the current session. this cannot be undone.}}",
            { count: props.itemCount },
          ),
          cancelLabel: gt("{count, plural, one {keep track} other {keep tracks}}", {
            count: props.itemCount,
          }),
          confirmLabel: gt("{count, plural, one {remove track} other {remove tracks}}", {
            count: props.itemCount,
          }),
        }
      : {
          title: gt("delete {albumTitle}?", { albumTitle: props.albumTitle }),
          description: gt(
            "{count, plural, =0 {this deletes the album from the current session. this cannot be undone.} one {this deletes the album and its track from the current session. this cannot be undone.} other {this deletes the album and all # tracks from the current session. this cannot be undone.}}",
            { count: props.trackCount },
          ),
          cancelLabel: gt("keep album"),
          confirmLabel: gt("delete album"),
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
