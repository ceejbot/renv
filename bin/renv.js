#!/usr/bin/env node

var _ = require('lodash'),
  fs = require('fs'),
  path = require('path'),
  appJsonPath = path.resolve(process.cwd(), './package.json'),
  app = fs.existsSync(appJsonPath) ? require(appJsonPath):  {name: 'app'},
  argv = null,
  chalk = require('chalk'),
  columnify = require('columnify'),
  command = null,
  inquirer = require('inquirer'),
  rc = require('rc')('renv', {
    hosts: '127.0.0.1:4001',
    ssl: false
  }, []),
  REnv = require('../'),
  renv = null,
  util = require('util'),
  traverse = require('traverse'),
  width = Math.min(require('window-size').width || 80, 80);
  options = {
    environment: {
      alias: 'e',
      description: 'what environment is being configured, e.g, development, production',
      default: 'development'
    },
    application: {
      alias: 'a',
      description: 'what application is this configuration for?',
      default: app.name
    },
    hosts: {
      alias: 'host',
      array: true,
      description: 'list of etcd host:port pairs',
      default: rc.hosts
    },
    'ssl': {
      default: rc.ssl,
      boolean: true,
      description: 'etcd server is SSL'
    },
    'ca-path': {
      array: true,
      description: 'optional array of paths to ssl certificate authorities',
    },
    'cert-path': {
      description: 'optional path to ssl client-cert'
    },
    'key-path': {
      description: 'optional path to ssl cert-key'
    }
  },
  yargs = require('yargs')
    .usage('$0 <command> [options]')
    .command('config', 'list all variables in /:application/:environment')
    .command('set', 'set an environment variable')
    .command('unset', 'delete an environment variable')
    .command('import', 'import configuration from a JSON file')
    .command('nuke', 'delete configuration for current application and environment')
    .command('dump', 'dump configuration for all applications and environments')
    .command('merge', 'merge the configuration for two applications')
    .completion('completion')
    .alias('h', 'help')
    .version(function() { return require('../package').version })
    .alias('version', 'v')
    .example('$0 [command] --help', "show the help message for a given command")
    .options(options)
  commands = {
    config: function() {
      argv = yargs.reset()
        .usage('$0 config [options]')
        .help('h')
        .alias('h', 'help')
        .options(_.extend({
          'f': {
            alias: 'format',
            default: 'console',
            description: "how should the config be output (either json, or console)"
          },
          'k': {
            alias: 'key',
            description: "output configuration for a key on an inner object"
          },
          'o': {
            alias: 'output',
            description: "output configuration to a file, rather than standard out"
          }
        }, options))
        .example('$0 config -e production', 'returns a list of config variables for the production environment')
        .argv;

      renv.getEnvironment()
        .then(function(environment) {
          printEnvironment(environment, argv.key, argv.output);
        })
        .catch(function(err) {
          console.log(JSON.stringify(err));
          console.log(chalk.red(err.message));
          process.exit(1);
        });
    },
    'set': function() {
      yargs.reset()
        .help('h')
        .alias('h', 'help')
        .usage('$0 set key=value [key=value...] [options]')
        .demand(2, chalk.red('must provide one or many key value pairs'))
        .example('$0 set BANANA=apple')
        .options(options);

      argv = yargs.argv;

      argv._.shift(); // remove the config:set command.

      renv.set(argv._)
        .then(function() {
          var output = _.chunk(renv._expandEquals(argv._), 2).map(function(chunk) {
            return chalk.bold(chunk[0]) + ' = ' + chalk.green(chunk[1])
          });

          console.log(chalk.bold('set: ') + output.join(', '));
        })
        .catch(function(err) {
          console.error(chalk.red(err.message));
          process.exit(1);
        });
    },
    'unset': function() {
      yargs.reset()
        .help('h')
        .alias('h', 'help')
        .usage('$0 config:unset key [key...] [options]')
        .demand(2, chalk.red('must provide a key to unset'))
        .example('$0 unset BANANA')
        .options(options)

      argv = yargs.argv;

      argv._.shift(); // remove the set command.

      renv.del(argv._)
        .then(function() {
          console.log(chalk.bold('unset: ') + _.map(argv._, function(k) {
            return chalk.red(k);
          }).join(', '));
        })
        .catch(function(err) {
          console.error(chalk.red(err.message));
          process.exit(1);
        });
    },
    'import': function() {
      argv = yargs.reset()
        .help('h')
        .alias('h', 'help')
        .usage('$0 import /path/to/file.json [options]')
        .demand(2, chalk.red('must provide path to JSON file'))
        .example('$0 import ./foo.json', 'load foo.json into default environment and app')
        .options(_.extend(options, {
          'k': {
            alias: 'key',
            description: "output configuration for a key on an inner object"
          }
        }))
        .argv;

      try {
        var json = require(path.resolve(argv._[1]))
        renv.setObject(json, argv.key);
        console.log(chalk.bold('imported:'), util.inspect(json, {colors: true}));
      } catch (err) {
        console.log(chalk.red(err.message));
      }
    },
    'nuke': function() {
      argv = yargs.reset()
        .help('h')
        .alias('h', 'help')
        .usage('$0 nuke [options]')
        .example('$0 nuke', 'Danger, Will Robinson.')
        .options(options)
        .argv;

      inquirer.prompt([{
        type: 'confirm',
        name: 'nuke',
        message: 'are you sure you want to destroy ' + chalk.bold(argv.application + '/' + argv.environment)
      }], function( answers ) {
        if (answers.nuke) {
          renv.deleteEnvironment()
            .then(function() {
              console.log(chalk.bold('destroyed: ') + chalk.red('/' + argv.application + '/' + argv.environment));
            })
            .catch(function(err) {
              console.log(chalk.red(err.message));
              process.exit(1);
            });
        } else {
          console.error(chalk.red('aborted'));
          process.exit(1);
        }
      });
    },
    'dump': function() {
      argv = yargs.reset()
        .usage('$0 dump [options]')
        .help('h')
        .alias('h', 'help')
        .options(_.extend({
          'f': {
            alias: 'format',
            default: 'console',
            description: "how should the config be output (either json, or console)"
          },
          'o': {
            alias: 'output',
            description: "output configuration to a file, rather than standard out"
          }
        }, options))
        .example('$0 dump', 'return config information for all environments')
        .argv;

      renv.getEnvironment('/')
        .then(function(environment) {
          printEnvironment(environment, null, argv.output);
        })
        .catch(function(err) {
          console.log(JSON.stringify(err));
          console.log(chalk.red(err.message));
          process.exit(1);
        });
    },
    'merge': function() {
      argv = yargs.reset()
        .usage('$0 merge [options]')
        .help('h')
        .alias('h', 'help')
        .options(_.extend({
          'application2': {
            demand: true,
            describe: 'merge configuration from this application'
          },
          'f': {
            alias: 'format',
            default: 'console',
            description: "how should the config be output (either json, or console)"
          },
          'k': {
            alias: 'key',
            description: "output configuration for a key on an inner object"
          },
          'o': {
            alias: 'output',
            description: "output configuration to a file, rather than standard out"
          }
        }, options))
        .example('$0 merge --application bar --application2 foo', "merge configuration from application 'foo' into application 'bar'")
        .demand('application2')
        .argv;

        var renv2 = new REnv({
          environment: argv.environment,
          application: argv.application2,
          etcd: {
            ssloptions: ssloptions,
            hosts: argv.hosts
          }
        });

        renv.merge(renv2)
          .then(function(environment) {
            printEnvironment(environment, argv.key, argv.output);
          })
          .catch(function(err) {
            console.log(JSON.stringify(err));
            console.log(chalk.red(err.message));
            process.exit(1);
          });
    }
  };

argv = yargs.argv;
command = argv._[0];

if (command && commands[command]) {
  var ssloptions = null;

  if (argv['cert-path'] && argv['key-path']) {
    ssloptions = {
      ca: _.map((argv['ca-path'] || []), function(p) {
        return fs.readFileSync(path.resolve(p));
      }),
      cert: fs.readFileSync(path.resolve(argv['cert-path'])),
      key: fs.readFileSync(path.resolve(argv['key-path']))
    };
  } else if (argv.ssl) {
    ssloptions = {};
  }

  renv = new REnv({
    environment: argv.environment,
    application: argv.application,
    etcd: {
      ssloptions: ssloptions,
      hosts: argv.hosts
    }
  });
  commands[command]();
} else {
  yargs.showHelp();
  if (command) console.error("unknown command '" + chalk.red(command) + "'");
}

// recursively print an environment.
function printEnvironment(environment, path, outputFile) {
  // print sub-objects in an environment.
  if (path) environment = traverse(environment).get(path.split('.'));
  path = path ? '.' + path : '';

  if (argv.format === 'json' || outputFile) {
    var json = JSON.stringify(environment, null, 2);
    if (outputFile) fs.writeFileSync(outputFile, json, 'utf-8');
    else console.log(JSON.stringify(environment, null, 2));
  } else {
    environment = _.mapValues(environment, function(v) {
      return util.inspect(v, {colors: true});
    });
    console.log(chalk.blue('==> ') + chalk.bold(renv.environment + path));
    console.log(columnify(environment, {showHeaders: false, config: {
      key: {minWidth: parseInt(width * 0.4), maxWidth: parseInt(width * 0.4)},
      value: {minWidth: parseInt(width * 0.6), maxWidth: parseInt(width * 0.6)},
    }}));
  }
}
