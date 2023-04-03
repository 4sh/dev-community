### Bootstrap

Install dependencies :
```npm ci```

### Finding best community groups

Create a `community-descriptor.json` file in root directory (you have a `community-descriptor.sample.json` sample file)

Run `npm run start` to start running a script who will try a lot of shufflings and will keep the "best" configuration
for actual inputs declared into `community-descriptor.json` file.

Whenever a configuration will be found, a **sound** will be played, and the configuration will be stored into `best-result.json` file.
