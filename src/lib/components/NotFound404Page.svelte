<script lang="ts">
	import ContainerCenterPage from "./ContainerCenterPage.svelte";

    let { msg }: {msg?:string | undefined} = $props();

    let use_msg = $derived(msg ? msg : "Sorry, the page you are looking for does not exist.")
</script>

<ContainerCenterPage>
    <div class="text-center">
        <h1 class="text-9xl font-bold mb-2">404</h1>
        <h3 class="text-2xl font-bold mb-4">Not Found</h3>
        <p class="mt-2 text-neutral-content mb-4">{use_msg}</p>
    </div>
</ContainerCenterPage>