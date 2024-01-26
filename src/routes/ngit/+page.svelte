<script lang="ts">
    import Container from "$lib/components/Container.svelte";
</script>

<Container>
    <div class="prose mt-8 m-auto">
        <h2 class=""><span class="text-purple-600">n</span>git</h2>
        <p>
            a command-line tool to create, list and apply PRs and patches to git
            repositories via nostr events.
        </p>
        It is designed to work seemlessly with this site gitworkshop.dev.

        <h3>Install</h3>
        <p>
            If you have cargo installed run<code>cargo install ngit</code>.
            Alternatively download:
        </p>
        <a
            href="https://github.com/DanConwayDev/ngit-cli/releases/download/v0.1.1/ngit-x86_64-unknown-linux-gnu.tar.gz"
            class="btn btn-neutral">Linux</a
        >
        <a
            href="https://github.com/DanConwayDev/ngit-cli/releases/download/v0.1.1/ngit-x86_64-apple-darwin.tar.gz"
            class="btn btn-neutral">Mac</a
        >
        <a
            href="https://github.com/DanConwayDev/ngit-cli/releases/download/v0.1.1/ngit-x86_64-pc-windows-msvc.zip"
            class="btn btn-neutral">Windows</a
        >
        v.0.1.1
        <p>add the binary to a directory from which it can be run globally.</p>
        <h3>Commands</h3>
        <p>
            All commands should be run from the directory of the git repository
        </p>
        <p>
            <span class="rounded p-2 bg-neutral font-mono"
                ><span class="py-5">ngit prs create</span></span
            >
            use this when you are on a feature branch to propose it gets merged into
            the remote branch by repository maintainer.
        </p>
        <p>
            It creates a PR event and patch events for each commit that isn't
            also in the main or master branch.
        </p>
        <p>
            <span class="rounded p-2 bg-neutral font-mono"
                ><span class="py-5">ngit prs list</span></span
            >
            fetches a selectable list of open PRs and, if one is selected and the
            repository is clean, will create a branch for it and apply the commits.
            If the branch already exists it will pull any updates.
        </p>
        <p>
            <span class="rounded p-2 bg-neutral font-mono"
                ><span class="py-5">ngit pull</span></span
            >
            if the repository is currently in a branch related to an existing PR,
            it will pull any updates from nostr.
        </p>
        <p>
            <span class="rounded p-2 bg-neutral font-mono"
                ><span class="py-5">ngit push</span></span
            >
            if the repository is currently in a branch related to an existing PR,
            it will create patch events for any new commits.
        </p>
        <p>
            <span class="rounded p-2 bg-neutral font-mono"
                ><span class="py-5">ngit claim</span></span
            >
            issue a repository nostr event which lists it on gitworkshop.dev and
            indicates you are accepting patches and PRs via nostr. This can be run
            many times to update the details. The relays will reflect your user relays
            plus blaster.
        </p>
        <p>
            It also creates an optional <span class="font-mono p-2 bg-base-200"
                >maintainers.yaml</span
            > file in the root of your repo that lists maintainers and relays. If
            commited it will make it smoother for contributors to find your repository
            event and also makes any future transfer of repository ownership easier.
        </p>
    </div>
</Container>
