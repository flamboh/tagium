<script lang="ts">
	import FileUpload from '$lib/components/FileUpload.svelte';
</script>

<header
	class="font-inter absolute top-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-y-2 text-white"
>
	<h1 class="text-4xl font-bold">Tagium</h1>
</header>

<main
	class="font-inter flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white"
>
	<div class="flex h-full flex-col items-center justify-center gap-y-4">
		<FileUpload />
	</div>
</main>
