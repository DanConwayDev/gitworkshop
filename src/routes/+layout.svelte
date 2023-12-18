<script>
  import "../app.css";
  import Navbar from "$lib/components/Navbar.svelte";
</script>

<Navbar />

<div class="mx-auto lg:container">
  <slot />
</div>
