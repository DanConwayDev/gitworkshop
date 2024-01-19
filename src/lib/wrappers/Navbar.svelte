<script lang="ts">
    import {
        checkForNip07Plugin,
        logged_in_user,
        login,
        nip07_plugin,
    } from "$lib/stores/users";
    import { onMount } from "svelte";
    import Navbar from "$lib/components/Navbar.svelte";

    onMount(checkForNip07Plugin);
</script>

<Navbar
    logged_in_user={$logged_in_user}
    nip07_plugin={$nip07_plugin}
    login_function={login}
/>
