# intro

[the need - git is great but become centralised]
[git used open, permissionless email for collaboraiton and it worked at scale]
[github created the centralising PR model which took over the market]
[we can make git decentralised again using nostr!]

# solving the key problem

[nostr shares charactstics with email so with nip34 we used the same primatives as patches-over-email. heres why [link]. TLDR; really simple, contributors don't have to host anything.]
[but fork-branch-PR-merge is the only workflow most developers have ever known]
[and its really hard to change peoples workflow]
[so ngit presents it to users with a workflow similar to what they know: branch-PR-merge. [more about why branch-PR-merge.]]

[PRs, issues and discussions are the most important aspect of decentralising git using nostr and the tools for this are ready to be used today with ngit and gitworkshop.dev]
[but this is where we are on the adoption curve: [insert adoption curve diagram showing that we are at innovator stage]]

# friction and challenges

[there are some key friction points and challenges that make it hard to adopt]
[the rest of this article will discussion some of these and outline a vision for how they are solved under the following headings.]
[1. the git server]
[2. CI / CD]
[3. browsing, discovery, social and notifications]
[4. migration]

[pholosophy throughout:]
[let git be git]
[let nostr be nostr]
[learn from success of others]
[hopefully you should see how this has been applied to the above problem]

## the git server

[#nip34 require that maintainer's branches (eg master) are hosted on a git server. here is why:]
[follows the original git vision and the let git be git pholosophy]
[its super efficent, battle tested and compatable with all the ways people use git (LFS, shallow cloning, etc)]
[maintains compatability with related systems without the need for plugins (eg for build and depoyment)]
[only repository maintainers need write access]

[in the original git model, all users would need to add the git server as a 'git remote' but with ngit, the git server is hidden behind a nostr remote. this enables:]
[hiding complexity from contributors and user so that only maintainers need to know about the git server compoenent to start using #gitvianostr]
[maintainers can swap git servers easily by updating their announcement event and contributors / users using ngit will automatically switch to the new one]

### git server challenges

[the need for a git server presents challenges]
[when creating a new repository, the maintiner must select a git server and this is a jarring experience. nearly all options, whether hosted or self-hosted:]
[come bloated with bloat social collaboration features (using centralised PR model) which are difficult or impossible to turn off]
[require manual configuraiton of new repositories and adding new maintainers through the browser ui config]
[require email sign up / KYC]

[this is a real turn-off for a new user exploring a decentralised and permissionless alternative to github]

[once the initial setup is done it works really well if a relaiable git server was choosen]
[unfortunately, thats a big if, as we have got really spoilt by the awesome uptime and reliablity of github. Even professionally run alternatives like codeberg has hours of downtime, which gets really fustrating as CI/CD and deployment grinds to a hault. This problem is exaserbated when self-hosting.]

[nearly all repositories on nostr use github as the git server. whilst maintainers can change at any point without disruption for their contributors, its is not exactly the decentralised dream.]

### git server vision

[turn the server from a single-point-of-truth-and-failure to something similar to a nostr relay]

ngit functiality already built:
[1. store the state of branches and tags in a nostr event - remove the reliance on a single server and validate that data recieved has been signged by the maintainer has sent the correct update]
[2. proxy requests to all servers in the announcement event - add redundancy and remove the need for any one server to match github on reliabilty and uptime]

nostr git server implementation needed that:
[1. just implements the git server protocol over unauthenticated http that only accepts pushes if the ref tip matches the latest state event]
[1. no user auth, no database, no web-ui, no bloat]
[1. accepts / rejects new repositories automatically upon first push based on content of repository announcement event referenced in the url path]

just like there are many free relays, paid and self hosted relays, there will be many free, zero-step signup options, as well as self hosted and paid option.

Some use WoT to filter out spam, some may have bandwidth repo size limits for free teirs, some whitelist npubs.

Some would bundle relay and blossom server to unify provision of repository data into a signle service.

this would make onboarding #GitViaNostr repositories as easy as entering a name and a multiselect of git server providers that announce via nip89.

[insert meme - https://i.imgflip.com/4/4rm35u.jpg with the following text]

1. nostr permissioned git server
2. no-kyc, zero-step signup
3. combined git / relay / blossom server
4. discovery via nip89 announcements
5. free at the point-of-use (subsided by CI/CD jobs)

## git-client-in-the-browser

there are a range of tasks that are currently done on a git server web-ui:

- browse code, commits, branches, tags, etc.
- create and display permalinks to specific lines in commits
- merge PRs
- make small commits and PRs on-the-fly

just as nobody goes to the web-ui of a relay (eg. https://nos.lol) to interact with notes, nobody should need to go to a git server to interact with repositories. We use the nostr protocol to interact with nostr relays and we should use the git protocol to interact with git servers. Instead of being restricted to the view / experience designed by the server operator, user should be able to choose the UX that work for them from a range of clients.

We need a library that lowers the barrier of entry to create these experiences that doesn't require a full clone of every repository and doesn't depend on propriatary APIs. As a starting point, I propose wrapping the (WASM combiled gitlib2)[https://github.com/petersalomonsen/wasm-git] library and creating useful functions, such as showing a file, which uses clever flags to minimise bandwidth usage (shallow clone, noblob, etc).

### note on song

fiajaf create 'song' with a somewhat similar vision. A self-hosted, nostr-permissioned git server with a relay baked in.
it uses the same spec for
it currently

# CI/CD problem

Before we dive into it, a quick note on managed solutions for web app deployments: its really to deploy to Vercel as they have a cli that can be (called in CI / CD jobs to kick of deployments)[https://vercel.com/docs/cli#using-in-a-ci/cd-environment].

most projects require CI / CD and this isn't smoothly integrated into #GitViaNostr yet.
nearly all git hosting options come bundled with CI/CD solutions.
There are also loosely coupled options such as jenkins, travis, circleci, etc.

one potential route it to lean into loosely coupled options and create nostr client but the other is much more exciting:

## DVMs for CI / CD

DVMs to provide a marketplace to run CI / CD tasks.

here is a POC https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner
Jobs can be kicked off in gitworkshop.dev with experimental mode turned on and paid for with testnuts.

trust levels vary:

A note on deployment. services like Vercel provide a cli that can be run in CI / CD jobs to manage

...

# browsing, discovery, social and notifications

# large patches via blossom

Finally, some patches are too big to fit in a nostr events. These should be included in a blossom file and referenced in a new patch kind.

# micro clients

#GitViaNostr shouldn't trend towards monolithic clients.

The best way to make progress is to create a small client which provides a provides a specific task.

git plaza is promising,

song
ngit / gitworkshop should not become monolithic.

There is a space for a client like gitworkshop that #GitViaNostr together but it should link out to specialist clients.

monolithic clients are not the future.

micro clients

whilst tools like ngit (the git plugin) and something like gitworkshop.dev tie together the git experience.

micro-clients

vibe-coded micro clients for specific tasks like PR review., CI / CD management

---

## notes / rejected sentances

---

dont include this: [you can also use it with the patches-over-email workflow this using gitstr or with ngit's send / list commands, although the tooling eg (managing read / unread) isn't built out]
[you can use it today]
