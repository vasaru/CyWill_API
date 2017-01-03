var async = require('async');
var express = require('express');
var bodyParser = require('body-parser');
var r = require('rethinkdb');

var config = require(__dirname + '/config.js');

var app = express();


//For serving the index.html and all the other front-end assets.
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

//The REST routes for "todos".
app.route('/vms')
  .get(listVms)
  .post(createTodoItem);

app.route('/vms/:id')
  .get(getVm)
  .put(updateTodoItem)
  .delete(deleteTodoItem);

//If we reach this middleware the route could not be handled and must be unknown.
app.use(handle404);

//Generic error handling middleware.
app.use(handleError);


/*
 * Retrieve all todo items.
 */
function listVms(req, res, next) {
  console.log("Getting all vms")
  r.table('vms').orderBy({index: 'servername'}).run(req.app._rdbConn, function(err, cursor) {
    if(err) {
      return next(err);
    }

    //Retrieve all the todos in an array.
    cursor.toArray(function(err, result) {
      if(err) {
        return next(err);
      }
      res.setHeader('content-type','application/json');
      res.send(result);
    });
  });
}

/*
 * Insert a new todo item.
 */
function createTodoItem(req, res, next) {
  var todoItem = req.body;
  todoItem.createdAt = r.now();

  console.dir(todoItem);

  r.table('todos').insert(todoItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Get a specific todo item.
 */
function getVm(req, res, next) {
  var vmID = req.params.id;

  r.table('vms').get(vmID).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result);
  });
}

/*
 * Update a todo item.
 */
function updateTodoItem(req, res, next) {
  var todoItem = req.body;
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).update(todoItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Delete a todo item.
 */
function deleteTodoItem(req, res, next) {
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).delete().run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json({success: true});
  });
}

/*
 * Page-not-found middleware.
 */
function handle404(req, res, next) {
  res.status(404).end('not found');
}

/*
 * Generic error handling middleware.
 * Send back a 500 page and log the error to the console.
 */
function handleError(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({err: err.message});
}

/*
 * Store the db connection and start listening on a port.
 */
function startExpress(connection) {
  app._rdbConn = connection;
  app.listen(config.express.port,'192.168.0.1');
  console.log('Listening on port ' + config.express.port);
}

/*
 * Connect to rethinkdb, create the needed tables/indexes and then start express.
 * Create tables/indexes then start express
 */
async.waterfall([
  function connect(callback) {
    r.connect(config.rethinkdb, callback);
  },
  function createDatabase(connection, callback) {
    //Create the database if needed.
    r.dbList().contains(config.rethinkdb.db).do(function(containsDb) {
      return r.branch(
        containsDb,
        {created: 0},
        r.dbCreate(config.rethinkdb.db)
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  }
], function(err, connection) {
  if(err) {
    console.error(err);
    process.exit(1);
    return;
  }

  startExpress(connection);
});