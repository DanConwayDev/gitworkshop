import { extractGithubDetails } from '$lib/components/repo/utils'

export const GET = async ({ params }: { params: { clone: string } }) => {
  const github_details = extractGithubDetails(decodeURIComponent(params.clone))
  if (github_details) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${github_details.org}/${github_details.repo_name}/HEAD/README.md`
    )
    const text = await res.text()

    return new Response(text)
  } else {
    // options:
    //  * add support for different git server implementations that serve raw
    //    files and cycle through the urls until we find the readme
    //  * add a worker that can use 'git archive' to get specific files
    //    * unfortunately the two options that can easily embeded within this
    //      sveltekit backend (wasm-git and isomorphicgit) don't support the
    //      'archive' command
    //      https://github.com/petersalomonsen/wasm-git/
    //      https://github.com/isomorphic-git
    //    * 'git clone' is too expensive for retrieving single files. even when
    //      done using treeless or blobless flags. see:
    //      https://noise.getoto.net/2020/12/21/get-up-to-speed-with-partial-clone-and-shallow-clone/

    return new Response(null)
  }
}
