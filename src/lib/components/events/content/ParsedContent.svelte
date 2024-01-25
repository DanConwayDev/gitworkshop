<script lang="ts">
    import type { NDKTag } from "@nostr-dev-kit/ndk";
    import {
        isParsedNewLine,
        isParsedText,
        parseContent,
        type ParsedPart,
    } from "./utils";
    export let content: string = "";
    export let tags: NDKTag[] = [];

    let fullContent: ParsedPart[] = [];

    $: fullContent = parseContent({ content, tags });
</script>

<div>
    {#each fullContent as part, i}
        {#if isParsedNewLine(part)}
            {#if part.value.length > 1}
                <br />
            {/if}
            <br />
        {:else if isParsedText(part)}
            {part.value}
        {/if}
    {/each}
</div>
