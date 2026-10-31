## Election Notes

## Installation

### nvm

Run:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/0.40.1/install.sh | bash
```

### NodeJS

**Dependencies:**

- nvm

From inside the project root directory, run:

```bash
nvm install
```

### Autoenv

Installing autoenv eliminates the need to run `nvm use` every time you `cd`
into the project.

**Dependencies:**

- nvm

Run:

```bash
nvm use node
```

```bash
curl -#fLo- 'https://raw.githubusercontent.com/hyperupcall/autoenv/master/scripts/install.sh' | sh
```

The above command will append a line to your `~/.bashrc` file that sources
`autoenv/activate.sh`. Add the following variables to your `~/.bashrc` file
immediately _before_ the source line:

```bash
AUTOENV_ENABLE_LEAVE=yes
AUTOENV_ENV_FILENAME=.autoenv
AUTOENV_ENV_LEAVE_FILENAME=.autoenv.leave
```

## GitHub Pages

The site is published from `master` by the [Publish GitHub Pages workflow](https://github.com/JoshuaCWebDeveloper/election-notes/actions/workflows/pages.yml).

In **Settings → Pages**, select **GitHub Actions** as the publishing source. Once enabled, pushes to `master` automatically deploy to https://joshuacwebdeveloper.github.io/election-notes/. The workflow can also be started manually in Actions.

The deployment uses the `/election-notes/` base path for both Vite assets and React Router; local development still uses `/`.
