import { error } from '@sveltejs/kit'

export const GET = async ({ params }: { params: { readme_url: string } }) => {
  // prevent abuse of the proxy by ensuring the url contains 'readme.md'
  if (
    !(
      params.readme_url.includes('readme.md') ||
      params.readme_url.includes('README.md')
    )
  )
    return new Response(null)

  let text: string | undefined
  try {
    const res = await fetch(params.readme_url, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      text = await res.text()
    } else {
      return error(res.status, res.statusText)
    }
  } catch {
    return error(408, 'timeout')
  }
  return new Response(text || null)

  // `https://raw.githubusercontent.com/${github_details.org}/${github_details.repo_name}/HEAD/README.md`
  // alternative approaches:
  //  * add a worker that can use 'git archive' to get specific files
  //    * unfortunately the two options that can easily embeded within this
  //      sveltekit backend (wasm-git and isomorphicgit) don't support the
  //      'archive' command
  //      https://github.com/petersalomonsen/wasm-git/
  //      https://github.com/isomorphic-git
  //    * 'git clone' is too expensive for retrieving single files. even when
  //      done using treeless or blobless flags. see:
  //      https://noise.getoto.net/2020/12/21/get-up-to-speed-with-partial-clone-and-shallow-clone/
  // files can be listed at:
  //  * gitea / forgejo https://codeberg.org/api/v1/repos/DanConwayDev/ngit-cli/git/trees/HEAD
  //  * github - https://api.github.com/repos/DanConwayDev/ngit-cli/git/trees/HEAD?recursive=1
  //  * gitlab - tbc
  //  * gogs - needs testing - https://github.com/gogs/docs-api/
}
