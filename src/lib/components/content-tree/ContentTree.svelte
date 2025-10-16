<script lang="ts">
	import {
		isBoldMark,
		isItalicMark,
		isLinkMark,
		isParagraphNode,
		isTextNode,
		isHeadingNode,
		isBulletListNode,
		isOrderedListNode,
		isBlockQuoteNode,
		isCodeBlockNode,
		isHardBreak,
		isHorizontalRule,
		isImageNode,
		isVideoNode,
		isNProfileNode,
		isNEventNode,
		isNAddrNode,
		isTweetNode,
		isYoutubeNode,
		isBolt11Node,
		type ContentSchema,
		type Node,
		type HeadingNode,
		type TextNode,
		type TagMark,
		isStrikeMark,
		isCodeMark,
		isTagMark,
		type Mark
	} from 'nostr-editor';
	import Tag from './Tag.svelte';
	import type { AtLeastOneArray } from '$lib/types';
	import Mention from './Mention.svelte';
	import EmbeddedEvent from './EmbeddedEvent.svelte';
	let { node }: { node: ContentSchema | Node } = $props();
</script>

{#snippet nodeSnippet(n?: ContentSchema | Node)}
	{#if n === undefined}{:else if n.type === 'doc'}
		<div class="prose">
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</div>
	{:else if isNProfileNode(n)}
		<Mention node={n} />
	{:else if isTextNode(n) && (n.marks || []).some((m) => isTagMark(m))}
		<Tag node={n as TextNode & { marks: AtLeastOneArray<TagMark> & Mark[] }} />
	{:else if isNEventNode(n) || isNAddrNode(n)}
		<EmbeddedEvent n_attr={n.attrs} />
	{:else if isTweetNode(n)}
		<div class="tweet-node">TODO - Tweet Node Content</div>
	{:else if isYoutubeNode(n)}
		<iframe title="embedded youtube video" src={n.attrs.src} frameborder="0" allowfullscreen
		></iframe>
	{:else if isBolt11Node(n)}
		<div class="bolt11-node">TODO - Bolt11 Node Content</div>
	{:else}
		{@render nodeStandardTipTapSnippet(n)}
	{/if}
{/snippet}

{#snippet nodeStandardTipTapSnippet(n: Node)}
	{#if isParagraphNode(n)}
		{#if n.content !== undefined}
			<p>
				{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
			</p>
		{/if}
	{:else if isTextNode(n)}
		{@render textSnippet(n)}
	{:else if isHeadingNode(n)}
		{@render headingSnippet(n)}
	{:else if isBulletListNode(n)}
		<ul>
			{#each n.content as child, i (i)}
				<li>
					{#each child.content as grandchild, i (i)}{@render nodeSnippet(grandchild)}{/each}
				</li>
			{/each}
		</ul>
	{:else if isOrderedListNode(n)}
		<ol>
			{#each n.content as child, i (i)}
				<li>
					{#each child.content as grandchild, i (i)}{@render nodeSnippet(grandchild)}{/each}
				</li>
			{/each}
		</ol>
	{:else if isBlockQuoteNode(n)}
		<blockquote>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</blockquote>
	{:else if isCodeBlockNode(n)}
		<pre><code
				>{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}</code
			></pre>
	{:else if isHardBreak(n)}
		<br />
	{:else if isHorizontalRule(n)}
		<hr />
	{:else if isImageNode(n)}
		<img src={n.attrs.src} alt={n.attrs.alt || ''} />
	{:else if isVideoNode(n)}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video controls>
			<source src={n.attrs.src} />
			Your browser does not support the video tag.
		</video>
	{:else}
		{JSON.stringify(n)}
		UNHANDLED SNIPPET
		{#if 'content' in n && Array.isArray(n.content)}
			{#each (n as { content: Node[] }).content as child, i (i)}{@render nodeSnippet(child)}{/each}
		{/if}
	{/if}
{/snippet}

{#snippet textSnippet(n: TextNode)}
	{#if n.marks === undefined}
		{n.text}
	{:else if (n.marks || []).some((m) => isItalicMark(m))}
		<em>{n.text}</em>
	{:else if (n.marks || []).some((m) => isBoldMark(m))}
		<strong>{n.text}</strong>
	{:else if (n.marks || []).some((m) => isStrikeMark(m))}
		<del>{n.text}</del>
	{:else if (n.marks || []).some((m) => isLinkMark(m))}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external URLs known safe -->
		<a href={n.marks.find((m) => isLinkMark(m))?.attrs.href}>{n.text}</a>
	{:else if (n.marks || []).some((m) => isCodeMark(m))}
		<code>{n.text}</code>
	{/if}
{/snippet}

{#snippet headingSnippet(n: HeadingNode)}
	{#if n.attrs.level === 1}
		<h1>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</h1>
	{:else if n.attrs.level === 2}
		<h2>
			{#each n.content as child, i (i)}
				{@render nodeSnippet(child)}{/each}
		</h2>
	{:else if n.attrs.level === 3}
		<h3>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</h3>
	{:else if n.attrs.level === 4}
		<h4>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</h4>
	{:else if n.attrs.level === 5}
		<h5>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</h5>
	{:else if n.attrs.level === 6}
		<h6>
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</h6>
	{:else}
		<div class="custom-heading">
			{#each n.content as child, i (i)}{@render nodeSnippet(child)}{/each}
		</div>
	{/if}
{/snippet}

{@render nodeSnippet(node)}
