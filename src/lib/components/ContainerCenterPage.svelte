<script lang="ts">
	// appears in the centre of the screen adapting for hardcoded Navbar and Footer heights
	// negative margin 24 matches the margin of the footer
</script>

<div class="flex items-center justify-center h-screen center-of-gw-screen -mb-24">
    <slot />
</div>

<style>
    .center-of-gw-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: calc(100vh - 130px);
        text-align: center;
    }
</style>