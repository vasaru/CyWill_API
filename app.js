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
  var page = parseInt(req.query.page);
  var pagesize = parseInt(req.query.pagesize);
  var sortstr = req.query.sort;
  var filter = req.query.filters;
  var total=0;
  var reverse=false;

  console.log("Getting some vms");

  console.log("item start = "+page);
  console.log("item stop = "+pagesize);
  var sortorder = "servername";
  if(sortstr) {
    console.log("Sort " + new Buffer(sortstr, 'base64') );
    var sortobj = JSON.parse(new Buffer(sortstr, 'base64'));
    sortorder=sortobj.by;
    if(sortobj.reverse) {
      reverse=true;
    } 

  }
  var filtsrv="(?i)$.*";
  var filtcreat="(?i)$.*";
  if(filter) {
    console.log("Filter " + new Buffer(filter, 'base64') );
    filtobj= JSON.parse(new Buffer(filter, 'base64'));
    if(filtobj["servername"])
      filtsrv="(?i)"+filtobj["servername"]+".*";
  }

 

  if(reverse) {
    r.table('vms').orderBy({index: r.desc(sortorder)}).filter(function(filt) {
      return filt("servername").match(filtsrv);
    }).run(req.app._rdbConn, function(err, cursor) {
      if(err) {
        return next(err);
      }

      //Retrieve all the todos in an array.
      cursor.toArray(function(err, result) {
        if(err) {
          return next(err);
        }
        console.log("Building result total: "+result.length);
        res.setHeader('content-type','application/json');
        var resstr = '{ "total": '+result.length+',\n'+
        ' "page": '+page+',\n'+
        ' "pagesize": '+pagesize+',\n'+
        ' "data": '+ JSON.stringify(result.slice(page,page+pagesize)) + '\n}'

  //      var vms = JSON.parse(result);

        res.send(resstr);
      });
    });

  } else {
    r.table('vms').orderBy({index: sortorder}).filter(function(filt) {
      return filt("servername").match(filtsrv);
    }).run(req.app._rdbConn, function(err, cursor) {
      if(err) {
        return next(err);
      }

      //Retrieve all the todos in an array.
      cursor.toArray(function(err, result) {
        if(err) {
          return next(err);
        }
        console.log("Building result total: "+result.length);
        res.setHeader('content-type','application/json');
        var resstr = '{ "total": '+result.length+',\n'+
        ' "page": '+page+',\n'+
        ' "pagesize": '+pagesize+',\n'+
        ' "data": '+ JSON.stringify(result.slice(page,page+pagesize)) + '\n}'

  //      var vms = JSON.parse(result);

        res.send(resstr);
      });
    });
    
  }
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
  app.listen(config.express.port,'localhost');
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
