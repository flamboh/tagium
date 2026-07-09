import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DestructiveActionDialogProps {
  open: boolean;
  itemCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DestructiveActionDialog({
  open,
  itemCount,
  onCancel,
  onConfirm,
}: DestructiveActionDialogProps) {
  const plural = itemCount !== 1;
  const noun = plural ? "tracks" : "track";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`remove ${plural ? `${itemCount} ` : ""}${noun}?`}</DialogTitle>
          <DialogDescription>
            {`This removes the ${noun} from the current session. This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {`keep ${noun}`}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {`remove ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
