#!/usr/bin/env node

const github = require('octonode');
const fs = require('fs');
const inquirer = require('inquirer');
const simpleGit = require('simple-git/promise');
const colors = require('colors');
const program = require('commander');
const package = require('./package.json');

async function main() {
  program.version(package.version).option('-r, --to-review', 'Show what I have to review');
  program.parse(process.argv);

  process.stdin.on('keypress', function(ch, key) {
    if (key && key.name === 'escape') {
      process.exit();
    }
  });

  const key = fs
    .readFileSync(`${process.env.HOME}/.pr-train`, 'UTF-8')
    .toString()
    .trim();
  const client = github.client(key);
  const ghsearch = client.search();

  const sg = simpleGit();

  let ghNick = await sg.raw(['config', '--get', `github.user`]);
  if (!ghNick) {
    ghNick = (await client.me().infoAsync())[0].login;
    await sg.addConfig('github.user', ghNick);
  }

  const remoteUrl = await sg.raw(['config', '--get', `remote.origin.url`]);
  const nickAndRepo = remoteUrl.match(/:(.*)\.git/)[1];

  const showMyToReview = program.toReview;

  const results = showMyToReview
    ? await ghsearch.issuesAsync({
        q: `state:open+repo:${nickAndRepo}+type:pr+review-requested:${ghNick}`,
        sort: 'updated',
        order: 'desc',
      })
    : await ghsearch.issuesAsync({
        q: `state:open+repo:${nickAndRepo}+type:pr+author:${ghNick}`,
        sort: 'updated',
        order: 'desc',
      });

  const mapPr = item => ({
    title: item.title,
    number: item.number,
    head: item.head,
    author: item.user.login,
  });
  const pullRequests = results[0].items.map(item => mapPr(item));

  const getChoiceTitle = (pr, index) =>
    showMyToReview
      ? `[${index + 1}] ${pr.title} ${colors.italic('[from ' + pr.author + ']')}`
      : `[${index + 1}] ${pr.title}`;

  const getChoices = prs => {
    return prs.map((pr, index) => ({
      name: getChoiceTitle(pr, index),
      value: pr,
    }));
  };

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'pr',
      message: 'Select a PR to checkout',
      choices: getChoices(pullRequests),
      pageSize: 100,
    },
  ]);

  const ghpr = client.pr(nickAndRepo, answer.pr.number);
  const prInfo = await ghpr.infoAsync();
  const headRef = prInfo[0].head.ref;
  if (showMyToReview) {
    console.log(`fetching ${headRef} from origin...`);
    await sg.fetch('origin', headRef);
  }
  console.log('Checking out', headRef);
  await sg.checkout(headRef);
  if (showMyToReview) {
    await sg.merge([`origin/${headRef}`, '--ff-only']);
    //await sg.pull('origin', headRef);
  }
}

try {
  main();
} catch (e) {
  console.log(e.message);
}