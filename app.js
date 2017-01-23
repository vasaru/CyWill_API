/* 
  API for Cygate multicustomer costing service
  Author: Henrik Kjellsson <henrik.kjellsson@cygate.se>

*/



var async = require('async');
var express = require('express');
var bodyParser = require('body-parser');
var passport = require('passport');
var r = require('rethinkdb');
var morgan = require('morgan');
var bcrypt = require('bcrypt-nodejs');
var cors = require('cors');

var config = require(__dirname + '/config.js');

var app = express();


//For serving the index.html and all the other front-end assets.
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(cors());

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

//The REST routes for "cywill".

app.route('/setupusers')
  .get(setupUsers);

app.route('/vms')
  .get(listVms);

app.route('/vms/:id')
  .get(getVm);

app.route('/costs')
  .get(listCosts)
  .post(createCostItem);

app.route('/recalculate/costs')
  .get(recalculateCosts)

app.route('/costs/:id')
  .get(getCost)
  .put(updateCostItem)
  .delete(deleteCostItem);

app.route('/customers')
  .get(listCustomers)
  .post(createCustomerItem);

app.route('/customers/:id')
  .get(getCustomer)
  .put(updateCustomerItem)
  .delete(deleteCustomerItem);

app.route('/vms/:id/alerts')
  .get(getVmAlerts);

app.route('/vms/:id/details')
  .get(getVmProperties);

app.route('/costkeys')
  .get(getCostKeys);




//If we reach this middleware the route could not be handled and must be unknown.
app.use(handle404);

//Generic error handling middleware.
app.use(handleError);

function processVmCost(conn, vm, vmd, costs) {
  var v;
  var tc=0.0;
  var cost={};
  console.log("in ProcessVmCost");
  console.log(vmd.vmid);
  for(var k=0; k< costs.length; k++) {
//    console.dir(costs[k]);
    if(costs[k].costname.indexOf(".")!=-1) {
//      console.log("Found split cost");
      var first = costs[k].costname.split(".")[0]
      var second = costs[k].costname.split(".")[1]
//      console.log("Getting cost of "+second+" of "+first + " = "+ vmd[first][second] + " for "+costs[k].cost);
      if(costs[k].itemtype == "Per GB") {
        if(vmd[first][second]>0) {
          tc+=vmd[first][second]*costs[k].cost;
          cost[costs[k].costname] = vmd[first][second]*costs[k].cost;      
        }
      }
    } else {
      if(costs[k].itemtype == "Amount") {
        tc+=vmd[costs[k].costname]*costs[k].cost;
        cost[costs[k].costname] = vmd[costs[k].costname]*costs[k].cost;
      }
//      console.log("Adding "+tc);
      if(costs[k].itemtype == "Per GB") {
        tc+=vmd[costs[k].costname]*costs[k].cost;
        cost[costs[k].costname] = vmd[costs[k].costname]*costs[k].cost;      
      }
//      console.log("Adding "+tc);
      if(costs[k].itemtype == "Per Occurrence") {
        tc+=costs[k].cost;
        cost[costs[k].costname] = costs[k].cost;      
      }
//      console.log("Adding "+tc);

    }
    if(costs[k].currency) {
      cost['currency'] = costs[k].currency;
    }
    

//    console.log("Getting cost for " + k.costitem);
//    console.log(vm[k.costitem]);
  }
  console.log("Total cost "+tc+" " +cost['currency']);

  r.table("vms").get(vmd.vmid).replace(function(cr) {
      return cr.without('cost_detail')
  }).run(conn, function (err, result) {
    if (err) {
      console.log(err);
      return err;
    }
    console.log(result);
  });
  r.table("vms").get(vmd.vmid).update({totalCost: tc, cost_detail: cost}).run(conn, function (err, result) {
    if (err) {
      console.log(err);
      return err;
    }
    console.log(result);
  });


}

function recalculateCosts(req, res, next) {
  var costs = [];

  console.log("Recalculate Costs");

  r.table('costs').
  run(req.app._rdbConn, function (err, cursor) {
    if (err) throw err;
    cursor.each(function (err, row) {
      if (err) {
        return next(err);
      }
//      console.log(row);
      costs.push(row);

    });
  });

  r.table('vms').run(req.app._rdbConn, function (err, cursor) {
    if (err) throw err;
    cursor.each(function (err, row) {
      if (err) {
        return next(err);
      }
//      console.log(row);
      r.table('vm_details').orderBy({
        index: r.desc('lastseen')
      }).filter({
        'vmid': row.vmid
      }).limit(1).run(req.app._rdbConn, function (err, cursor) {
        if (err) {
          return next(err);
        }
        cursor.toArray(function (err, res) {
          if(err) {
            return next(err);
          }
          processVmCost(req.app._rdbConn,row[0],res[0],costs);
        })
      })



    });
  }); 
  res.send({'result': 'Ok'});
}

function getCostKeys(req, res, next) {
  var detailkeys = [];
  var vmkeys = [];
  var reskey = [];
  r.table('vm_details').limit(1).run(req.app._rdbConn, function (err, cursor) {
    if (err) throw err;
    cursor.toArray(function (err, result) {
      if (err) {
        return next(err);
      }
      detailkeys = (Object.keys(result[0]));
      storagekeys=(Object.keys(result[0].storage));

      //console.dir(detailkeys);
      r.table('vms').limit(1).run(req.app._rdbConn, function (err, cursor) {
        if (err) throw err;
        cursor.toArray(function (err, result) {
          if (err) {
            return next(err);
          }
          vmkeys = (Object.keys(result[0]));
          for (elem in vmkeys) {
            reskey.push(vmkeys[elem]);
          }
          for (elem in detailkeys) {
            reskey.push(detailkeys[elem]);
          }
          for (elem in storagekeys) {
            reskey.push("storage."+storagekeys[elem]);
          }

          reskey = Array.from(new Set(reskey))
          reskey.sort();


          //        vmkeys=JSON.stringify(vmkeys)+JSON.stringify(detailkeys);
          //        reskeystr = '\'' + reskeys.join('\'','\'') + '\'';
          console.dir(reskey);

          console.log("Building result total: " + result.length);
          res.setHeader('content-type', 'application/json');
          var resstr = '{ "total": ' + result.length + ',\n' +
            ' "data": [' + JSON.stringify(vmkeys) + ']\n}'

          //      var vms = JSON.parse(result);

          res.send(JSON.stringify(reskey));
        });
      });
    });
  });

}

function setupUsers(req, res, next) {
  var defaultuser = {
    username: 'admin',
    password: '',
    role: 'admin'
  }

  var salt = bcrypt.genSaltSync(10);
  // Hash the password with the salt
  var hash = bcrypt.hashSync("Spectum42", salt);

  defaultuser.password = hash;

  console.log("setting up defaultuser");
  console.dir(defaultuser);

  r.table('users').count().run(req.app._rdbConn, function (err, result) {
    if (err) throw err;
    console.log(result);
    if (result == 0) {
      r.table('users').insert(defaultuser, {
        returnChanges: true
      }).run(req.app._rdbConn, function (err, result) {
        if (err) {
          return next(err);
        }

        res.json(result.changes[0].new_val);
      });
    } else {
      res.json({
        result: "Already added"
      });
    }
  });
}

/*
 * Retrieve all vms items.
 */
function listVms(req, res, next) {
  var page;
  var pagesize;
  var sortstr = req.query.sort;
  var filter = req.query.filters;
  var total = 0;
  var reverse = false;

  console.log("Getting some vms");

  if (req.query.page) {
    page = parseInt(req.query.page);
  } else {
    page = 1
  }
  if (req.query.pagesize) {
    pagesize = parseInt(req.query.pagesize);
  } else {
    pagesize = 10
  }


  console.log("item start = " + page);
  console.log("item stop = " + pagesize);
  var sortorder = "DC_Cluster_Server";
  if (sortstr) {
    console.log("Sort " + new Buffer(sortstr, 'base64'));
    var sortobj = JSON.parse(new Buffer(sortstr, 'base64'));
    sortorder = sortobj.by;
    if (sortobj.reverse) {
      reverse = true;
    }

  }
  var filtsrv = "(?i)$.*";
  var filtcreat = "(?i)$.*";
  var filtobj;
  if (filter) {
    console.log("Filter " + new Buffer(filter, 'base64'));
    filtobj = JSON.parse(new Buffer(filter, 'base64'));
    if (filtobj["servername"])
      filtsrv = "(?i)" + filtobj["servername"] + ".*";
    if (filtobj["cluster"])
      filtsrv = "(?i)" + filtobj["cluster"] + ".*";
    if (filtobj["datacenter"])
      filtsrv = "(?i)" + filtobj["datacenter"] + ".*";

  }



  query = r.table('vms');
  if (reverse) {
    query = query.orderBy({
      index: r.desc(sortorder)
    });
  } else {
    query = query.orderBy({
      index: sortorder
    });
  }
  if (filtobj) {
    Object.keys(filtobj).forEach(function (key) {
      var val = filtobj[key];
      query = query.filter(function (q) {
        return q(key).match("(?i)" + val + ".*")
      })
    });
  }
  console.log(query);

  query.run(req.app._rdbConn, function (err, cursor) {
    if (err) {
      return next(err);
    }

    //Retrieve all the todos in an array.
    cursor.toArray(function (err, result) {
      if (err) {
        return next(err);
      }
      console.log("Building result total: " + result.length);
      res.setHeader('content-type', 'application/json');
      var resstr = '{ "total": ' + result.length + ',\n' +
        ' "page": ' + page + ',\n' +
        ' "pagesize": ' + pagesize + ',\n' +
        ' "data": ' + JSON.stringify(result.slice(page, page + pagesize)) + '\n}'

      //      var vms = JSON.parse(result);

      res.send(resstr);
    });
  });
}

/*
 * Get a specific todo item.
 */
function getVm(req, res, next) {
  var vmID = req.params.id;
  var vmres;
  var vmdetres;
  var vmalertres;

  r.table('vms').get(vmID).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result);
  });
}

function getVmAlerts(req, res, next) {
  var vmID = req.params.id;

  r.table('vm_alerts').orderBy({
    index: 'lastseen'
  }).filter({
    'vmid': vmID
  }).run(req.app._rdbConn, function (err, cursor) {
    if (err) {
      return next(err);
    }
    cursor.toArray(function (err, result) {
      if (err) {
        return next(err);
      }

      res.json(result);
    });
  });
}

function getVmProperties(req, res, next) {
  var vmID = req.params.id;
  console.log('Getting details for ' + vmID);
  r.table('vm_details').orderBy({
    index: r.desc('lastseen')
  }).filter({
    'vmid': vmID
  }).run(req.app._rdbConn, function (err, cursor) {
    if (err) {
      return next(err);
    }
    cursor.toArray(function (err, result) {
      if (err) {
        return next(err);
      }
      console.dir(result);
      res.json(result);
    });
  });
}

/*
 * Get a specific todo item.
 */
function getCost(req, res, next) {
  var vmID = req.params.id;
  var vmres;
  var vmdetres;
  var vmalertres;

  r.table('vms').get(vmID).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result);
  });
}


/*
 * Insert a new todo item.
 */
function createCostItem(req, res, next) {
  var costItem = req.body;
  //  costItem.createdAt = r.now();
  console.log("In createCostItem");
  console.dir(costItem);


  r.table('costs').insert(costItem, {
    returnChanges: true
  }).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}


/*
 * Update a todo item.
 */
function updateCostItem(req, res, next) {
  var todoItem = req.body;
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).update(todoItem, {
    returnChanges: true
  }).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Delete a todo item.
 */
function deleteCostItem(req, res, next) {
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).delete().run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json({
      success: true
    });
  });
}

/*
 * Get a specific todo item.
 */
function getCustomer(req, res, next) {
  var vmID = req.params.id;
  var vmres;
  var vmdetres;
  var vmalertres;

  r.table('vms').get(vmID).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result);
  });
}

/*
 * Get a specific todo item.
 */
function listCustomers(req, res, next) {
  var vmID = req.params.id;
  var vmres;
  var vmdetres;
  var vmalertres;

  r.table('vms').get(vmID).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result);
  });
}



/*
 * Insert a new todo item.
 */
function createCustomerItem(req, res, next) {
  var todoItem = req.body;
  todoItem.createdAt = r.now();

  console.dir(todoItem);

  r.table('todos').insert(todoItem, {
    returnChanges: true
  }).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}


/*
 * Update a todo item.
 */
function updateCustomerItem(req, res, next) {
  var todoItem = req.body;
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).update(todoItem, {
    returnChanges: true
  }).run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Delete a todo item.
 */
function deleteCustomerItem(req, res, next) {
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).delete().run(req.app._rdbConn, function (err, result) {
    if (err) {
      return next(err);
    }

    res.json({
      success: true
    });
  });
}
/*
 * Retrieve all vms items.
 */
function listCosts(req, res, next) {
  var page;
  var pagesize;
  var sortstr = req.query.sort;
  var filter = req.query.filters;
  var total = 0;
  var reverse = false;

  console.log("Getting some costs");

  if (req.query.page) {
    page = parseInt(req.query.page);
  } else {
    page = 1
  }
  if (req.query.pagesize) {
    pagesize = parseInt(req.query.pagesize);
  } else {
    pagesize = 10
  }

  console.log("item start = " + page);
  console.log("item stop = " + pagesize);
  var sortorder = "";
  if (sortstr) {
    console.log("Sort " + new Buffer(sortstr, 'base64'));
    var sortobj = JSON.parse(new Buffer(sortstr, 'base64'));
    sortorder = sortobj.by;
    if (sortobj.reverse) {
      reverse = true;
    }

  }
  var filtsrv = "(?i)$.*";
  var filtcreat = "(?i)$.*";
  var filtobj;
  if (filter) {
    console.log("Filter " + new Buffer(filter, 'base64'));
    filtobj = JSON.parse(new Buffer(filter, 'base64'));
    /*    if(filtobj["servername"])
          filtsrv="(?i)"+filtobj["servername"]+".*";
        if(filtobj["cluster"])
          filtsrv="(?i)"+filtobj["cluster"]+".*";
        if(filtobj["datacenter"])
          filtsrv="(?i)"+filtobj["datacenter"]+".*";
    */
  }



  query = r.table('costs');
  if (reverse) {
    query = query.orderBy({
      index: r.desc(sortorder)
    });
    /*    } else {
          query=query.orderBy({index: sortorder});*/
  }
  if (filtobj) {
    Object.keys(filtobj).forEach(function (key) {
      var val = filtobj[key];
      query = query.filter(function (q) {
        return q(key).match("(?i)" + val + ".*")
      })
    });
  }
  console.log(query);

  query.run(req.app._rdbConn, function (err, cursor) {
    if (err) {
      return next(err);
    }

    //Retrieve all the todos in an array.
    cursor.toArray(function (err, result) {
      if (err) {
        return next(err);
      }
      console.log("Building result total: " + result.length);
      res.setHeader('content-type', 'application/json');
      var resstr = '{ "total": ' + result.length + ',\n' +
        ' "page": ' + page + ',\n' +
        ' "pagesize": ' + pagesize + ',\n' +
        ' "data": ' + JSON.stringify(result.slice(page, page + pagesize)) + '\n}'

      //      var vms = JSON.parse(result);

      res.send(resstr);
    });
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
  res.status(500).json({
    err: err.message
  });
}

/*
 * Store the db connection and start listening on a port.
 */
function startExpress(connection) {
  app._rdbConn = connection;
  app.listen(config.express.port, 'localhost');
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
    r.dbList().contains(config.rethinkdb.db).do(function (containsDb) {
      return r.branch(
        containsDb, {
          created: 0
        },
        r.dbCreate(config.rethinkdb.db)
      );
    }).run(connection, function (err) {
      callback(err, connection);
    });
  }
], function (err, connection) {
  if (err) {
    console.error(err);
    process.exit(1);
    return;
  }

  startExpress(connection);
});