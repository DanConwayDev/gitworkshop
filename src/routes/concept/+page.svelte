<script lang="ts">
  import AlertError from '$lib/components/AlertError.svelte'
  import Container from '$lib/components/Container.svelte'
  import SvelteMarkdown from 'svelte-markdown'

  async function get_md() {
    const res = await fetch('/concept.md')
    return await res.text()
  }
</script>

<svelte:head>
  <title>GitWorkshop: Concept</title>
</svelte:head>

<Container>
  {#await get_md()}
    <p>loading...</p>
  {:then md}
    <article class="prose prose-sm mt-3">
      <SvelteMarkdown options={{ gfm: true }} source={md} />
    </article>
  {:catch error}
    <AlertError>
      {error.message}
    </AlertError>
  {/await}
</Container>
