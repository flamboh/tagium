interface FileState {
	selectedFile: File | null;
	isValidMP3: boolean;
	error: string | null;
}

function createFileStore() {
	const state = $state<FileState>({
		selectedFile: null,
		isValidMP3: false,
		error: null
	});

	function setFile(file: File | null) {
		if (!file) {
			state.selectedFile = null;
			state.isValidMP3 = false;
			state.error = null;
			return;
		}

		// Validate MP3 file
		if (!file.type.includes('audio/mpeg') && !file.name.toLowerCase().endsWith('.mp3')) {
			state.selectedFile = null;
			state.isValidMP3 = false;
			state.error = 'Please select a valid MP3 file';
			return;
		}

		state.selectedFile = file;
		state.isValidMP3 = true;
		state.error = null;
	}

	function clearFile() {
		setFile(null);
	}

	return {
		get selectedFile() {
			return state.selectedFile;
		},
		get isValidMP3() {
			return state.isValidMP3;
		},
		get error() {
			return state.error;
		},
		setFile,
		clearFile
	};
}

export const fileStore = createFileStore();
