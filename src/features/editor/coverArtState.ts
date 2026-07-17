export interface CropSource {
  url: string;
  owned: boolean;
}

export interface CoverArtState {
  activeUploadId: number;
  uploadedCover: File | null;
  cropSource: CropSource | null;
  isCropperOpen: boolean;
  isProcessing: boolean;
  error: string | null;
  isErrorOpen: boolean;
}

export const initialCoverArtState: CoverArtState = {
  activeUploadId: 0,
  uploadedCover: null,
  cropSource: null,
  isCropperOpen: false,
  isProcessing: false,
  error: null,
  isErrorOpen: false,
};

export type CoverArtAction =
  | { type: "uploadStarted"; uploadId: number; closeCropper?: boolean }
  | { type: "uploadSucceeded"; uploadId: number; file: File }
  | { type: "uploadFailed"; uploadId: number; message: string }
  | { type: "cropOpened"; source: CropSource }
  | { type: "cropClosed" }
  | { type: "errorOpenChanged"; open: boolean }
  | { type: "reset"; uploadId: number };

export const coverArtReducer = (state: CoverArtState, action: CoverArtAction): CoverArtState => {
  switch (action.type) {
    case "uploadStarted":
      return {
        ...state,
        activeUploadId: action.uploadId,
        isProcessing: true,
        ...(action.closeCropper ? { cropSource: null, isCropperOpen: false } : {}),
      };
    case "uploadSucceeded":
      if (action.uploadId !== state.activeUploadId) return state;
      return {
        ...state,
        uploadedCover: action.file,
        isProcessing: false,
        error: null,
        isErrorOpen: false,
      };
    case "uploadFailed":
      if (action.uploadId !== state.activeUploadId) return state;
      return {
        ...state,
        isProcessing: false,
        error: action.message,
        isErrorOpen: true,
      };
    case "cropOpened":
      return { ...state, cropSource: action.source, isCropperOpen: true };
    case "cropClosed":
      return { ...state, cropSource: null, isCropperOpen: false };
    case "errorOpenChanged":
      return { ...state, isErrorOpen: action.open };
    case "reset":
      return { ...initialCoverArtState, activeUploadId: action.uploadId };
  }
};
