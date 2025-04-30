a vision for #GitViaNostr

# intro

Git is a fanastic distributed version control system but has become centralised. Originally git used open, permissionless email for collaboraiton and it worked at scale. Github created the centralising PR model which took over the market. We can make git permissionless and distributed again with nostr!

We have built tools support git collaboration via nostr but there is significant friction preventing adoption. This article outlines a vision for how we remove that friction and move along the adoption curve.

# The Key Challanage is Social

[the key challenge to make git decentralised is the how to propose and discuss changes - PRs, Issues and the surounding discussion]
[I believe that with nostr and nip34 we have the right protocol to bring make the dream a reality]
[over the last 2 year, we have built the tools around this challenge and they are ready to use today]
[but we must be realist that there is some significant friction to onboard new repositories and there is lots of work to do to remove this.]
[this is where we are on the adoption curve: [insert adoption curve diagram showing that we are at innovator stage]]

[in this article I explore a renewed vision for #GitViaNostr and how we move it forward]

# Pholosophy

lets start with the underlying principles that I that I first published a few years ago:

- let git be git
- let nostr be nostr
- learn from success of others

but I'd like to add an extra one:

- lean into anarchy and resist monolthic development

## Micro clients FTW

Nostr is a cerebration of simplicity. lets not move away for that. monolthic developements trend towards complexity.
Ambitious projects like gitworkshop.dev, which seeks to cover broad aspects of the code collaboration experience, shouldn't stiffle great ideas and innovation.
The primatives in nip34 are simple and we need to make it easy to vibe-code a #GitViaNostr app in an afternoon.
Micro clients should lead the way and explore new workflows, experiences, models of thinking.
The landscape of tools surounding code collaboration is board and there is lots of opporunities to innovate.

[insert diaggram

- code
- proposed changes
- Issues
- Discussion
- Review
- CI / CD
- project management
- bounties and freelancing
- code snippets
- project discovery
  ]

may 1000 flowers bloom and 1000 more after them.

# PR and Pactches

[the central purpose of #GitViaNostr is to librate social discussion around code collaboration from permissioned big tech walled gardens]
[to date most of the effort has been focused on this challenge]
[nostr shares charactstics with email so with nip34 we used the same primatives as patches-over-email. TLDR; really simple, contributors don't have to host anything.]
[if you know and love the patches-over-email workflow then you can use that workflow with nostr using [gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us) or `ngit send` / `ngit list`] commands.
[but fork-branch-PR-merge is the only workflow most developers have ever known]
[and its really hard to change peoples workflow]
[so ngit and gitworkshop.dev presents it to users with a workflow similar to what they know: [branch-PR-merge](https://gitworkshop.dev/quick-start)]
[I beleive this strikes the right balance between familiarity, good UX and alignment with the protocol. [try it out](https://gitworkshop.dev/quick-start) and see what you think.]
[With ngit and gitworkshop.dev we now have good tooling for this and, whilst we should be open to innovation in this area, I believe the barrier to adoption now lies elsewhere]

# friction and challenges

[lets look at some of some key friction points]

[there are some key friction points and challenges that make it hard to adopt]
[the rest of this article will discussion some of these and outline a vision for how they are solved under the following headings.]
[1. the git server]
[2. CI / CD]
[3. browsing, discovery, social and notifications]
[4. migration]

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
[1. just implements the [git smart http protocol](https://git-scm.com/docs/http-protocol) without authentication (no ssh) but only accepts pushes if the ref tip matches the latest state event]
[1. no user auth, no database, no web-ui, no bloat]
[1. accepts / rejects new repositories automatically upon first push based on content of repository announcement event referenced in the url path]

just like there are many free relays, paid and self hosted relays, there will be many free, zero-step signup options, as well as self hosted and paid option.

Some use WoT to filter out spam, some may have bandwidth repo size limits for free tiers, some whitelist npubs.

Some would bundle relay and blossom server to unify provision of repository data into a single service. These would probably only accept content related to the stored repositories.

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

We need a library that lowers the barrier of entry to create these experiences that doesn't require a full clone of every repository and doesn't depend on propriatary APIs. As a starting point, I propose wrapping the [WASM combiled gitlib2](https://github.com/petersalomonsen/wasm-git) library for the web and creating useful functions, such as showing a file, which uses clever flags to minimise bandwidth usage (shallow clone, noblob, etc).

It needs to be so easy that someone could vibe code a git experience in an afternoon.

## song

nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 created [song](https://gitworkshop.dev/fiatjaf.com/song) with a complementary vision. A self-hosted, nostr-permissioned git server with a relay baked in.

We collaborated on the nostr-permissioning approach now reflected in nip34 so in principle it should be compatible with ngit. Its currently a WIP.

# CI/CD problem

most projects require CI / CD and whilst this is often bundled with git hosting solutions, it currently isn't smoothly integrated into #GitViaNostr yet.
there are many loosely coupled options, such as jenkins, travis, circleci, etc, that could be integrated with nostr.
but the more exciting prospect is to use DVMs.

## DVMs for CI / CD

Nostr Data Vending Machines (DVMs) can provide a marketplace of CI / CD task runners with cashu for micro payments.

There are various trust levels in CI / CD tasks:

- from running tests with no secrets
- tasks using updatable secrets (API keys)
- unverifiable builds and steps that sign with andriod, nostr or PGP keys

DVMs allow for tasks to kicked-off with specific providers using a cashu token as a payment.

It might be suitable for some high comput and easily verifiable tasks to be run by the cheapest available providers.
medium trust tasks could be run by providers with good reputation.
high trust tasks could be run on self-hosted runners.

job requests, status and results all get published to nostr for diplsay in git-focused nostr clients.

Jobs could be trigged manually or self-hosted runners could be configured to watch a nostr repository and kick-off jobs using their own runners without payment.

But I'm most excited about the prospect of Watcher Agents.

### CI/CD Watcher Agents

AI agents empowered with a nip60 cashu wallet to run tasks based on activity, such as a push to master or a new PR, using the most suitable available DVM runner that meets the users criteria.
To keep them running, anybody could top up their nip60 cashu wallet, otherwise the watcher turns off when the funds run out.
It could be users, maintainers or anyone interested in helping the project could top up the Watcher Agents balance.

Part of building a reputation as a CI / CD provider could be running reliable hosting (git server, relay and blossom server) for all FOSS nostr git repositories.

This provides a sustainable reveneue model for hosting providers and creates the incentives for many free at the point of use hosting providers.
This in turn would allow one-click nostr repository creation workflows, instantly hosted by many different providers.

## Progress To Date

nostr:npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr and nostr:npub16ux4qzg4qjue95vr3q327fzata4n594c9kgh4jmeyn80v8k54nhqg6lra7 have been working on a runner that uses github actions yaml syntax (using act) [dvm-cicd-runner](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner) and takes cashu payment. You can see [example runs on gitworkshop](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner/actions). It current takes testnuts, doesn't give any change and the schema will likely change.

note: the actions tab on gitworkshop.dev is currently available on all repositories if you turn on experimental mode (under settings in the user menu).

Its a WIP and expect the format and schema to evolve.

...

# Easy Web App Deployment

For those disapointed not to find a 'Nostr' button to import a git repository to Vercel menu: take heart, they made it easy.
[vercel.com_import_options.png](./vercel.com_import_options.png)
there is a vercel cli that can be easily [called in CI / CD jobs to kick of deployments](https://vercel.com/docs/cli#using-in-a-ci/cd-environment). Not all managed solutions for web app deployment (eg. netlify) make it that easy.

# browsing, discovery, social and notifications

recieving notifications on daily driver nostr apps is one of the killer features of nostr.
but review git related notifications to make sure we havn't missed anything important - we need that.

we need tools to serve our curiosity. Discover and follow projects, see discussions that we might interested in, see updates that might relate to what we are working on.

And we haven't even got to Search

# large patches via blossom

Finally, some patches are too big to fit in a nostr events. blossom is perfect for this. These should be included in a blossom file and referenced in a new patch kind.

# Concluding Thoughts

## Contributions

Fiatjaf ([gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us), [song](https://gitworkshop.dev/naddr1qvzqqqrhnypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqy2hwumn8ghj7emfwshxv6tpw34xze3wvdhk6qqywdhkuecg7qylu), [patch34](https://patch34.pages.dev)), dluvian ([gitplaza](https://gitworkshop.dev/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza/prs))
contributions, integrations and experiments.

Freelance
Lez (ngit contributions, [git-remote-blossom](https://gitworkshop.dev/naddr1qvzqqqrhnypzpn7hma38nx3zuwz2f26a4rzqymy8tvge6r68cfckkgxd4jwvrudxqy28wumn8ghj7un9d3shjtnwdaehgu3wdp6sqyn8d96z6un9d4hhgefdvfkx7umndaks2fzhtl)), , , Five ([SatShoot](https://satshoot.com), [Flotilla-Budabit](https://budabit.org)), Biz (Flotilla-Budabit, [Nostr Git Extension](https://github.com/chebizarro/nostr-git-extension)), Randy McMillan ([gnostr](https://github.com/gnostr-org) and experiments), and others.

Guga ([git-remote-nostr](https://github.com/gugabfigueiredo/git-remote-nostr))

Project Management
Vivek npub1ltx67888tz7lqnxlrg06x234vjnq349tcfyp52r0lstclp548mcqnuz40t ([kanbanstr](https://kanbanstr.com))
Code Snippets
Chris npub1ygzj9skr9val9yqxkf67yf9jshtyhvvl0x76jp5er09nsc0p3j6qr260k2 ([nodebin.io](https://nodebin.io))
Karnage ([snipsnip.dev](https://snipsnip.dev))

Auggie

Silbrerengel npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z for lots of testing, bug reporting and encournagmeent.

There are also other projects that havn't posted any code or inactive.

Let me know if I've missed any active projects.

---

## notes / rejected sentances

---

dont include this: [you can also use it with the patches-over-email workflow this using gitstr or with ngit's send / list commands, although the tooling eg (managing read / unread) isn't built out]
[you can use it today]
vibe-coded micro clients for specific tasks like PR review., CI / CD management

song - Its a WIP and as of April 2025, cloning doesnt work with ngit, possibly because it doesn't implement [git smart http protocol](https://git-scm.com/docs/http-protocol), which is potentially needed by git plugins like ngit. Also, the relay doesn't accept patches, issues, discussion, etc.
