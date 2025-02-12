<script lang="ts">
	// appears in the centre of the screen adapting for hardcoded Navbar and Footer heights
</script>

<div class="flex items-center justify-center h-screen center-of-gw-screen">
    <slot />
</div>

<style>
    .center-of-gw-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: calc(100vh - 110px);
        text-align: center;
    }
</style>