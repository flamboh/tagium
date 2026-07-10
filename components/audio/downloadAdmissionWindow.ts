export const DOWNLOAD_ADMISSION_MAX_COST = 40;
export const DOWNLOAD_ADMISSION_WINDOW_MS = 60_000;
export const DEFAULT_DOWNLOAD_ADMISSION_COST = 2;

export type DownloadAdmissionResult =
  | { status: "admitted" }
  | { status: "waiting"; waitMs: number };

export interface DownloadAdmissionWindow {
  reserve: (cost: number, nowMs: number) => DownloadAdmissionResult;
}

export const createDownloadAdmissionWindow = ({
  maxCost = DOWNLOAD_ADMISSION_MAX_COST,
  windowMs = DOWNLOAD_ADMISSION_WINDOW_MS,
}: {
  maxCost?: number;
  windowMs?: number;
} = {}): DownloadAdmissionWindow => {
  if (!Number.isFinite(maxCost) || maxCost <= 0) {
    throw new Error("download admission max cost must be positive.");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("download admission window must be positive.");
  }

  let reservations: Array<{ cost: number; reservedAtMs: number }> = [];

  return {
    reserve: (cost, nowMs) => {
      if (!Number.isFinite(cost) || cost <= 0 || cost > maxCost) {
        throw new Error("download admission cost must fit within the window budget.");
      }

      reservations = reservations.filter(
        (reservation) => reservation.reservedAtMs + windowMs > nowMs,
      );
      const usedCost = reservations.reduce((total, reservation) => total + reservation.cost, 0);

      if (usedCost + cost <= maxCost) {
        reservations.push({ cost, reservedAtMs: nowMs });
        return { status: "admitted" };
      }

      let releasedCost = 0;
      const orderedReservations = [...reservations].sort(
        (left, right) => left.reservedAtMs - right.reservedAtMs,
      );
      for (const reservation of orderedReservations) {
        releasedCost += reservation.cost;
        if (usedCost - releasedCost + cost <= maxCost) {
          return {
            status: "waiting",
            waitMs: Math.max(0, reservation.reservedAtMs + windowMs - nowMs),
          };
        }
      }

      throw new Error("download admission wait could not be calculated.");
    },
  };
};
