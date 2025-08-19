<script lang="ts">
	import { Input } from '$lib/components/ui/input';
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
		<Input type="file" accept="audio/mpeg" class="w-full max-w-md bg-zinc-800" />
	</div>
</main>
