<script lang="ts">
    import type { NDKTag } from "@nostr-dev-kit/ndk";
    import parseDiff from "parse-diff";

    export let content: string = "";
    export let tags: NDKTag[] = [];
    export let lite: boolean = true;

    let commit_id = extractTagContent("commit") || "[unknown commit_id]";
    let commit_message = extractTagContent("description") || "[untitled]";

    let files = parseDiff(content);
    function extractTagContent(name: string): string | undefined {
        let tag = tags.find((tag) => tag[0] === name);
        return tag ? tag[1] : undefined;
    }
</script>

<div class="">
    <div class="bg-base-300 rounded-t p-1 flex">
        <article class="ml-2 prose font-mono flex-grow">
            {commit_message}
        </article>
        <div class="text-xs text-neutral p-1 flex-none align-middle">
            commit
        </div>
    </div>

    <div class="bg-base-200 p-1 rounded-b">
        <table class="table table-xs table-zebra">
            <tr>
                <td class="text-xs">Changes: </td>
                <td class="text-right">
                    <span class="text-xs font-mono"
                        >{commit_id.substring(0, 8)}</span
                    >
                </td>
            </tr>
            {#each files as file}
                <tr>
                    <td>
                        <span
                            class:text-success={file.new}
                            class:text-error={file.deleted}
                            class="text-success"
                        >
                            {file.to || file.from}
                        </span>
                    </td>
                    <td class="text-right">
                        <span class="text-success">+{file.additions}</span>
                        <span class="text-error">- {file.deletions}</span>
                    </td>
                </tr>
            {/each}
        </table>
    </div>
</div>
