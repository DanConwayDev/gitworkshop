<script lang="ts">
  export let size: 'sm' | 'md' = 'md'
  const version = 'v1.6.0'
</script>

<div class="prose" class:text-sm={size === 'sm'}>
  <p>
    download binaries and add them to a directory from which they can be run
    globally:
  </p>
  <p>
    <a
      href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-x86_64-unknown-linux-gnu.tar.gz"
      class="btn btn-neutral"
      class:btn-sm={size === 'sm'}>Linux</a
    >
    <a
      href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-aarch64-apple-darwin.tar.gz"
      class="btn btn-neutral"
      class:btn-sm={size === 'sm'}>Mac</a
    >
    <a
      href="https://github.com/DanConwayDev/ngit-cli/releases/download/{version}/ngit-{version}-x86_64-pc-windows-msvc.zip"
      class="btn btn-neutral"
      class:btn-sm={size === 'sm'}>Windows</a
    >
    {version}
  </p>
  <p>
    alternatively, if you have cargo installed run<code>cargo install ngit</code
    >
  </p>
</div>
