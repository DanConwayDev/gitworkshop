now published as naddr1qvzqqqr4gupzpgqgmmc409hm4xsdd74sf68a2uyf9pwel4g9mfdg8l5244t6x4jdqq2kcjm2wfm5c6nt95u4x33jf9uxcunyv4jkzwthjvt

# A Vision for #GitViaNostr

Git has long been the standard for version control in software development, but over time, we has lost its distributed nature. Originally, Git used open, permissionless email for collaboration, which worked well at scale. However, the rise of GitHub and its centralized pull request (PR) model has shifted the landscape.

Now, we have the opportunity to revive Git's permissionless and distributed nature through Nostr!

We’ve developed tools to facilitate Git collaboration via Nostr, but there are still significant friction that prevents widespread adoption. This article outlines a vision for how we can reduce those barriers and encourage more repositories to embrace this approach.

First, we’ll review our progress so far. Then, we’ll propose a guiding philosophy for our next steps. Finally, we’ll discuss a vision to tackle specific challenges, mainly relating to the role of the Git server and CI/CD.

I am the lead maintainer of [ngit](https://gitworkshop.dev/dan@gitworkshop.dev/ngit) and [gitworkshop.dev](https://gitworkshop.dev/dan@gitworkshop.dev/gitworkshop), and I’ve been fortunate to work full-time on this initiative for the past two years, thanks to an OpenSats grant.

## How Far We’ve Come

The aim of #GitViaNostr is to liberate discussions around code collaboration from permissioned walled gardens. At the core of this collaboration is the process of proposing and applying changes. That's what we focused on first.

Since Nostr shares characteristics with email, and with NIP34, we’ve adopted similar primitives to those used in the patches-over-email workflow. This is because of their simplicity and that they don’t require contributors to host anything, which adds reliability and makes participation more accessible.

However, the fork-branch-PR-merge workflow is the only model many developers have known, and changing established workflows can be challenging. To address this, we developed a new workflow that balances familiarity, user experience, and alignment with the Nostr protocol: the [branch-PR-merge](https://gitworkshop.dev/quick-start) model.

This model is implemented in [ngit](https://gitworkshop.dev/ngit), which includes a Git plugin that allows users to engage without needing to learn new commands. Additionally, [gitworkshop.dev](https://gitworkshop.dev) offers a GitHub-like interface for interacting with PRs and issues. We encourage you to try them out using the [quick start guide](https://gitworkshop.dev/quick-start) and share your feedback. You can also explore PRs and issues with [gitplaza](https://gitworkshop.dev/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza).

For those who prefer the patches-over-email workflow, you can still use that approach with Nostr through [gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us) or the `ngit send` and `ngit list` commands, and explore patches with [patch34](https://patch34.pages.dev).

The tools are now available to support the core collaboration challenge, but we are still at the beginning of the adoption curve.

Before we dive into the challenges—such as why the Git server setup can be jarring and the possibilities surrounding CI/CD—let’s take a moment to reflect on how we should approach the challenges ahead of us.

## Philosophy

Here are some foundational principles I shared a few years ago:

- Let Git be Git
- Let Nostr be Nostr
- Learn from the successes of others

I’d like to add one more:

- Embrace anarchy and resist monolithic development.

## Micro Clients FTW

Nostr celebrates simplicity, and we should strive to maintain that. Monolithic developments often lead to unnecessary complexity. Projects like gitworkshop.dev, which aim to cover various aspects of the code collaboration experience, should not stifle innovation.

Just yesterday, the launch of following.space demonstrated how vibe-coded micro clients can make a significant impact. They can be valuable on their own, shape the ecosystem, and help push large and widely used clients to implement features and ideas.

The primitives in NIP34 are straightforward, and if there are any barriers preventing the vibe-coding of a #GitViaNostr app in an afternoon, we should work to eliminate them.

Micro clients should lead the way and explore new workflows, experiences, and models of thinking.

Take kanbanstr.com. It provides excellent project management and organization features that work seamlessly with NIP34 primitives.

From kanban to code snippets, from CI/CD runners to SatShoot—may a thousand flowers bloom, and a thousand more after them.

# Friction and Challenges

## The Git Server

In #GitViaNostr, maintainers' branches (e.g., `master`) are hosted on a Git server. Here’s why this approach is beneficial:

- **Follows the original Git vision** and the "let Git be Git" philosophy.
- **Super efficient**, battle-tested, and compatible with all the ways people use Git (e.g., LFS, shallow cloning).
- **Maintains compatibility** with related systems without the need for plugins (e.g., for build and deployment).
- **Only repository maintainers need write access.**

In the original Git model, all users would need to add the Git server as a 'git remote.' However, with ngit, the Git server is hidden behind a Nostr remote, which enables:

- **Hiding complexity** from contributors and users, so that only maintainers need to know about the Git server component to start using #GitViaNostr.
- **Maintainers can easily swap Git servers** by updating their announcement event, allowing contributors/users using ngit to automatically switch to the new one.

### Challenges with the Git Server

While the Git server model has its advantages, it also presents several challenges:

1. **Initial Setup**: When creating a new repository, maintainers must select a Git server, which can be a jarring experience. Most options come with bloated social collaboration features tied to a centralized PR model, often difficult or impossible to disable.
2. **Manual Configuration**: New repositories require manual configuration, including adding new maintainers through a browser UI, which can be cumbersome and time-consuming.

3. **User Onboarding**: Many Git servers require email sign-up or KYC (Know Your Customer) processes, which can be a significant turn-off for new users exploring a decentralized and permissionless alternative to GitHub.

Once the initial setup is complete, the system works well if a reliable Git server is chosen. However, this is a significant "if," as we have become accustomed to the excellent uptime and reliability of GitHub. Even professionally run alternatives like Codeberg can experience downtime, which is frustrating when CI/CD and deployment processes are affected. This problem is exacerbated when self-hosting.

Currently, most repositories on Nostr rely on GitHub as the Git server. While maintainers can change servers without disrupting their contributors, this reliance on a centralized service is not the decentralized dream we aspire to achieve.

### Vision for the Git Server

The goal is to transform the Git server from a single point of truth and failure into a component similar to a Nostr relay.

#### Functionality Already in ngit to Support This

1. **State on Nostr**: Store the state of branches and tags in a Nostr event, removing reliance on a single server. This validates that the data received has been signed by the maintainer, significantly reducing the trust requirement.

2. **Proxy to Multiple Git Servers**: Proxy requests to all servers listed in the announcement event, adding redundancy and eliminating the need for any one server to match GitHub's reliability.

#### Implementation Requirements

To achieve this vision, the Nostr Git server implementation should:

1. **Implement the [Git Smart HTTP Protocol](https://git-scm.com/docs/http-protocol)** without authentication (no SSH) and only accept pushes if the reference tip matches the latest state event.

2. **Avoid Bloat**: There should be no user authentication, no database, no web UI, and no unnecessary features.

3. **Automatic Repository Management**: Accept or reject new repositories automatically upon the first push based on the content of the repository announcement event referenced in the URL path and its author.

Just as there are many free, paid, and self-hosted relays, there will be a variety of free, zero-step signup options, as well as self-hosted and paid solutions.

Some servers may use a Web of Trust (WoT) to filter out spam, while others might impose bandwidth or repository size limits for free tiers or whitelist specific npubs.

Additionally, some implementations could bundle relay and blossom server functionalities to unify the provision of repository data into a single service. These would likely only accept content related to the stored repositories rather than general social nostr content.

The potential role of CI / CD via nostr DVMs could create the incentives for a market of highly reliable free at the point of use git servers.

This could make onboarding #GitViaNostr repositories as easy as entering a name and selecting from a multi-select list of Git server providers that announce via NIP89.

https://image.nostr.build/badedc822995eb18b6d3c4bff0743b12b2e5ac018845ba498ce4aab0727caf6c.jpg

## Git Client in the Browser

Currently, many tasks are performed on a Git server web UI, such as:

- Browsing code, commits, branches, tags, etc.
- Creating and displaying permalinks to specific lines in commits.
- Merging PRs.
- Making small commits and PRs on-the-fly.

Just as nobody goes to the web UI of a relay (e.g., [nos.lol](https://nos.lol)) to interact with notes, nobody should need to go to a Git server to interact with repositories. We use the Nostr protocol to interact with Nostr relays, and we should use the Git protocol to interact with Git servers. This situation has evolved due to the centralization of Git servers. Instead of being restricted to the view and experience designed by the server operator, users should be able to choose the user experience that works best for them from a range of clients.
To facilitate this, we need a library that lowers the barrier to entry for creating these experiences. This library should not require a full clone of every repository and should not depend on proprietary APIs. As a starting point, I propose wrapping the [WASM-compiled gitlib2](https://github.com/petersalomonsen/wasm-git) library for the web and creating useful functions, such as showing a file, which utilizes clever flags to minimize bandwidth usage (e.g., shallow clone, noblob, etc.).

This approach would not only enhance clients like gitworkshop.dev but also bring forth a vision where Git servers simply run the Git protocol, making vibe coding Git experiences even better.

## song

nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 created [song](https://gitworkshop.dev/fiatjaf.com/song) with a complementary vision that has shaped how I see the role of the git server. Its a self-hosted, nostr-permissioned git server with a relay baked in. Its currently a WIP and there are some compatability with ngit that we need to work out.

We collaborated on the nostr-permissioning approach now reflected in nip34.

I'm really excited to see how this space evolves.

# CI/CD

Most projects require CI/CD, and while this is often bundled with Git hosting solutions, it is currently not smoothly integrated into #GitViaNostr yet. There are many loosely coupled options, such as Jenkins, Travis, CircleCI, etc., that could be integrated with Nostr.

However, the more exciting prospect is to use DVMs (Data Vending Machines).

## DVMs for CI/CD

Nostr Data Vending Machines (DVMs) can provide a marketplace of CI/CD task runners with Cashu for micro payments.

There are various trust levels in CI/CD tasks:

- Tasks with no secrets eg. tests.
- Tasks using updatable secrets eg. API keys.
- Unverifiable builds and steps that sign with Android, Nostr, or PGP keys.

DVMs allow tasks to be kicked off with specific providers using a Cashu token as payment.

It might be suitable for some high-compute and easily verifiable tasks to be run by the cheapest available providers. Medium trust tasks could be run by providers with a good reputation, while high trust tasks could be run on self-hosted runners.

Job requests, status, and results all get published to Nostr for display in Git-focused Nostr clients.

Jobs could be triggered manually, or self-hosted runners could be configured to watch a Nostr repository and kick off jobs using their own runners without payment.

But I'm most excited about the prospect of Watcher Agents.

### CI/CD Watcher Agents

AI agents empowered with a NIP60 Cashu wallet can run tasks based on activity, such as a push to master or a new PR, using the most suitable available DVM runner that meets the user's criteria. To keep them running, anyone could top up their NIP60 Cashu wallet; otherwise, the watcher turns off when the funds run out. It could be users, maintainers, or anyone interested in helping the project who could top up the Watcher Agent's balance.

As aluded to earlier, part of building a reputation as a CI/CD provider could involve running reliable hosting (Git server, relay, and blossom server) for all FOSS Nostr Git repositories.

This provides a sustainable revenue model for hosting providers and creates incentives for many free-at-the-point-of-use hosting providers. This, in turn, would allow one-click Nostr repository creation workflows, instantly hosted by many different providers.

## Progress to Date

nostr:npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr and nostr:npub16ux4qzg4qjue95vr3q327fzata4n594c9kgh4jmeyn80v8k54nhqg6lra7 have been working on a runner that uses GitHub Actions YAML syntax (using act) for the [dvm-cicd-runner](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner) and takes Cashu payment. You can see [example runs on GitWorkshop](https://gitworkshop.dev/arjen@swissdash.site/dvm-cicd-runner/actions). It currently takes testnuts, doesn't give any change, and the schema will likely change.

**Note**: The actions tab on GitWorkshop is currently available on all repositories if you turn on experimental mode (under settings in the user menu).

It's a work in progress, and we expect the format and schema to evolve.

## Easy Web App Deployment

For those disapointed not to find a 'Nostr' button to import a git repository to Vercel menu: take heart, they made it easy.
[vercel.com_import_options.png](./vercel.com_import_options.png)
there is a vercel cli that can be easily [called in CI / CD jobs to kick of deployments](https://vercel.com/docs/cli#using-in-a-ci/cd-environment). Not all managed solutions for web app deployment (eg. netlify) make it that easy.

# Many More Opportunities

## Large Patches via Blossom

I would be remiss not to mention the large patch problem. Some patches are too big to fit into Nostr events. Blossom is perfect for this, as it allows these larger patches to be included in a blossom file and referenced in a new patch kind.

## Enhancing the #GitViaNostr Experience

Beyond the large patch issue, there are numerous opportunities to enhance the #GitViaNostr ecosystem. We can focus on improving browsing, discovery, social and notifications. Receiving notifications on daily driver Nostr apps is one of the killer features of Nostr. However, we must ensure that Git-related notifications are easily reviewable, so we don’t miss any critical updates.

We need to develop tools that cater to our curiosity—tools that enable us to discover and follow projects, engage in discussions that pique our interest, and stay informed about developments relevant to our work.

Additionally, we should not overlook the importance of robust search capabilities and tools that facilitate migrations.

# Concluding Thoughts

The design space is vast. Its an exciting time to be working on freedom tech. I encourage everyone to contribute their ideas and creativity and get vibe-coding!

I welcome your honest feedback on this vision and any suggestions you might have. Your insights are invaluable as we collaborate to shape the future of #GitViaNostr. Onward.

## Contributions

To conclude, I want to acknowledge some the individuals who have made recent code contributions related to #GitViaNostr:

nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 ([gitstr](https://gitworkshop.dev/naddr1qqrxw6t5wd68yq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqpmejqg4waehxw309ankjapwve5kzar2v9nzucm0d50cj6us), [song](https://gitworkshop.dev/naddr1qvzqqqrhnypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqy2hwumn8ghj7emfwshxv6tpw34xze3wvdhk6qqywdhkuecg7qylu), [patch34](https://patch34.pages.dev)), nostr:npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks ([gitplaza](https://gitworkshop.dev/npub1useke4f9maul5nf67dj0m9sq6jcsmnjzzk4ycvldwl4qss35fvgqjdk5ks/gitplaza/prs))

nostr:npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume (ngit contributions, [git-remote-blossom](https://gitworkshop.dev/naddr1qvzqqqrhnypzpn7hma38nx3zuwz2f26a4rzqymy8tvge6r68cfckkgxd4jwvrudxqy28wumn8ghj7un9d3shjtnwdaehgu3wdp6sqyn8d96z6un9d4hhgefdvfkx7umndaks2fzhtl)),nostr:npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw ([SatShoot](https://satshoot.com), [Flotilla-Budabit](https://budabit.org)), nostr:npub1ehhfg09mr8z34wz85ek46a6rww4f7c7jsujxhdvmpqnl5hnrwsqq2szjqv ([Flotilla-Budabit](https://budabit.org), [Nostr Git Extension](https://github.com/chebizarro/nostr-git-extension)), nostr:npub1ahaz04ya9tehace3uy39hdhdryfvdkve9qdndkqp3tvehs6h8s5slq45hy ([gnostr](https://github.com/gnostr-org) and experiments), and others.

nostr:npub1uplxcy63up7gx7cladkrvfqh834n7ylyp46l3e8t660l7peec8rsd2sfek ([git-remote-nostr](https://github.com/gugabfigueiredo/git-remote-nostr))

Project Management
nostr:npub1ltx67888tz7lqnxlrg06x234vjnq349tcfyp52r0lstclp548mcqnuz40t ([kanbanstr](https://kanbanstr.com))
Code Snippets
nostr:npub1ygzj9skr9val9yqxkf67yf9jshtyhvvl0x76jp5er09nsc0p3j6qr260k2 ([nodebin.io](https://nodebin.io))
nostr:npub1r0rs5q2gk0e3dk3nlc7gnu378ec6cnlenqp8a3cjhyzu6f8k5sgs4sq9ac ([snipsnip.dev](https://snipsnip.dev))

CI / CD
nostr:npub16ux4qzg4qjue95vr3q327fzata4n594c9kgh4jmeyn80v8k54nhqg6lra7, nostr:npub1hw6amg8p24ne08c9gdq8hhpqx0t0pwanpae9z25crn7m9uy7yarse465gr

and for their nostr:npub1c03rad0r6q833vh57kyd3ndu2jry30nkr0wepqfpsm05vq7he25slryrnw, nostr:npub1qqqqqq2stely3ynsgm5mh2nj3v0nk5gjyl3zqrzh34hxhvx806usxmln03 and nostr:npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z for their testing, feedback, ideas and encouragement.

Thank you for your support and collaboration! Let me know if I've missed you.
