### Bootstrap

Install dependencies :
```npm ci```

### Pre-requisites / Configuration

Create a `members.json` file in root directory (you have a `members.sample.json` sample file, but this file could
also be generated/exported from an in-house spreadsheet).

Create a `community-descriptor.json` file in root directory (you have a `community-descriptor.sample.json` sample file)

Download a sound which will be played whenever a new result beating previous score will be found :
```
wget https://assets.mixkit.co/active_storage/sfx/2848/2848.wav -O mixkit-gaming-lock-2848.wav
```

### Finding best community groups

Run `npm run find-best-community-groups compute <Track name>` (example: `npm run find-best-community-groups compute "Sessions libres"`)
to look for the best spreading of members across different groups declared in `<Track name>`.

The algorithm is pretty simple: it will make a shuffling or track subscribers across different track's declared groups,
and will give a "score" (based on several criteria) to the configuration (lower scores are better).

Given that this is totally random, the more you spend time on this, and the best results you will get
(keep in mind that a score `< 0.2` should be nice already).

Whenever a better score is found, a **sound** will be played, and the Track's group filling will be stored
into `best-result.json` file.

Repeat this for every configured Tracks, so that you get a `best-result.json` file covering all these Tracks.
To speed up things for tracks with single groups (such as "Focus" tracks), you can run `npm run find-best-community-groups compute-single-groups`
which is going to run `compute` on each single-group tracks to have at least 1 execution (and a corresponding `best-result.json` entry
for these tracks where shuffling is useless)

### Showing every Tracks' best results

Run `npm run find-best-community-groups show` to list every Tracks and spreading of members (+ stats) across tracks'
groups.

This should give you an overview of the upcoming cycle configuration to check if everything looks good.

### Updating `members.json` groups

Once the cycle is started and you communicated groups assignments to everyone, you can "enrich" `members.json` file
with the new groups assignments coming from `best-results.json` file, so that these group will be taken
into consideration for the `same path` constraint during your next cycle.

To do this, simply execute `npm run find-best-community-groups record-member-groups` and `best-results.json` file will be updated.

_As a side note, if you configured people in the `absentsFromThisCycle` property, absent people will have their
latest group valued to `""`._
