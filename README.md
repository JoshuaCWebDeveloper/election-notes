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
