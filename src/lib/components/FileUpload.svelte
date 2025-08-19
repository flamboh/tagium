<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { fileStore } from '$lib/stores/file.svelte';

	function handleFileChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0] || null;
		fileStore.setFile(file);
	}

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}
</script>

<div class="w-full max-w-md space-y-4">
	<div class="space-y-2">
		<Input 
			type="file" 
			accept="audio/mpeg,.mp3" 
			class="bg-zinc-800 border-zinc-700 text-white file:bg-zinc-700 file:text-white file:border-0 file:rounded-md" 
			onchange={handleFileChange}
		/>
		
		{#if fileStore.error}
			<p class="text-sm text-red-400">{fileStore.error}</p>
		{/if}
	</div>

	{#if fileStore.selectedFile && fileStore.isValidMP3}
		<div class="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
			<h3 class="text-sm font-medium text-zinc-300 mb-2">Selected File</h3>
			<div class="space-y-1 text-sm">
				<p class="text-white font-medium">{fileStore.selectedFile.name}</p>
				<p class="text-zinc-400">Size: {formatFileSize(fileStore.selectedFile.size)}</p>
				<p class="text-zinc-400">Type: {fileStore.selectedFile.type || 'audio/mpeg'}</p>
			</div>
		</div>
	{/if}
</div>