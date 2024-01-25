<script lang="ts">
    import ParsedContent from "./content/ParsedContent.svelte";
    export let sendReply: (content: string) => void = (content: string) => {};
    export let submitting = false;
    let submit = () => {
        sendReply(content);
    };
    let content = "";
</script>

<div class="">
    <textarea
        disabled={submitting}
        bind:value={content}
        class="textarea textarea-primary w-full"
        placeholder="reply..."
    ></textarea>
    <div class="flex">
        <div class="flex-auto"></div>
        <button
            on:click={submit}
            disabled={submitting}
            class="btn btn-primary align-bottom mt-2 btn-sm align-right"
        >
            {#if submitting}
                Sending
            {:else}
                Send
            {/if}
        </button>
    </div>
</div>
