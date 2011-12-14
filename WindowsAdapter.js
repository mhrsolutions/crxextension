// See Purple/license.txt for Google BSD license
// Copyright 2011 Google, Inc. johnjbarton@johnjbarton.com

/*global console */

/*
 Barrier proxy for chrome.windows. One per Debugger domain.
 
 This object has two jobs:
   1) proxy chrome.windows functions,
   2) insure that calls from the Web side only operate on windows
      created from the Web side of the crx2app channel
 
 Debugger access to windows is limited to same-domain.
 */


var makeWindowsAdapter = function(chrome, PostSource) {

function WindowsAdapter(origin) {
  this.debuggerOrigin = origin; // the debugger we accept connections from
  this.instanceIndex = ++WindowsAdapter.instanceCounter;
  this.name = WindowsAdapter.path + '.' + WindowsAdapter.instanceCounter;
  this.chromeWindowIds = [];  // only these ids can be used by client
  this.chromeTabIds = [];     // only these tabs can be used by client
  this._bindListeners();
  // chrome.window functions available to client WebApps
  this.api = ['create', 'getAll'];
  this._connect();
}

WindowsAdapter.path = 'chrome.windows';
WindowsAdapter.instanceCounter = 0;

WindowsAdapter.prototype = {
  
  // API functions, restricted versions of the chrome.windows functions
  
  create: function(createData) {
    var cleanCreateData = this._cleanseCreateData(createData);
    // we are listening for onCreated events, but
    // we don't want two onCreated() calls, 
    // thus we route the response to just check error
    chrome.windows.create(cleanCreateData, this.noErrorPosted);
  },
  
  getAll: function(getInfo) {
    chrome.windows.getAll(getInfo, this.onGetAll);
  },

  //------------------------------------------------------------------------------------ 

  isAccessibleTab: function(tabId) {
    return (this.chromeTabIds.indexOf(tabId) > -1);
  },
  //------------------------------------------------------------------------------------ 
  // callback from chrome.windows.create
  // @param http://code.google.com/chrome/extensions/dev/windows.html#type-Window
  onCreated: function(win) {
    if (!win) {
      return; // incognito windows are not supported because we can't track them
    }
    console.assert( !win.tabs || (win.tabs.length === 1), "A newly created chrome.Window should have at most one tab");
    this.chromeWindowIds.push(win.id); // index in this array is our new id
    if (!this.listening) {
      chrome.windows.onRemoved.addListener(this.onRemoved);
      this.listening = true;
    }
    this.postMessage({source:this.getPath(), method:'onCreated', params:[win]});
  },
  
  putUpInfobar: function(tabId) {
      var details = {tabId: tabId, path: "warnDebugging.html?debuggerDomain="+this.debuggerOrigin, height: 16};
      chrome.experimental.infobars.show(details, function(win){
        console.log("putUpInfobar ", win);
      });
  },

  // callback from onRemoved, clean up and event the client
  onRemoved: function(windowId) {
    this.barrier(windowId, arguments, function(windowId, index) {
      this.chromeWindowIds.splice(index, 1);
      this.postMessage({source:this.getPath(), method:'onRemoved'});
    });
  },

  // callback from getAll, convert result to subset visible to client
  onGetAll: function(chromeWindows) {
    var cleanWindows = [];
    chromeWindows.forEach(function(win) {
      this.barrier(win.id, arguments, function(win) {
        cleanWindows.push(win);
      });
    }.bind(this));
    this.postMessage({source:this.getPath(), method:'onGetAll', params:cleanWindows});
  },

  //---------------------------------------------------------------------------------------------------------
  _connect: function() {
    console.log("WindowsAdapter "+this.name+" connect "+this.debuggerOrigin);
    // prepare to record the windows allowed to debugger
    chrome.windows.onCreated.addListener(this.onCreated);
    // prepare to clean up the records
    chrome.windows.onRemoved.addListener(this.onRemoved);
  },
  
  _disconnect: function() {
    console.log("WindowsAdapter "+this.name+" disconnect "+this.debuggerOrigin);
    this.setPort(null); // prevent any more messages
    chrome.windows.onCreated.removeListener(this.onCreated);
    chrome.windows.onRemoved.removeListener(this.onRemoved);
  },

  //---------------------------------------------------------------------------------------------------------
  // Call the action iff the window is allowed to the debugger
  // action takes the same arguments as the caller of barrier, plus index is available
  barrier: function (winId, args, action) {
    var index = this.chromeWindowIds.indexOf(winId);
    if (index > -1) {
      // we probably are called with arguments, not an array
      var _args = Array.prototype.slice.call(args);
      action.apply( this, _args.concat([index]) );
    } // else not ours
  },

  // copy allowed fields, force values on others
  _cleanseCreateData: function(createData) {
    return {
      url: createData.url,
      left: createData.left,
      top: createData.top,
      width: createData.width,
      height: createData.height,
      focused: createData.focused,
      type: createData.type,
      incognito: false // true   // Forced 
    };
  },

  _bindListeners: function() {
    this.onCreated = this.onCreated.bind(this);
    this.onRemoved = this.onRemoved.bind(this);
    this.onGetAll = this.onGetAll.bind(this);
  }
};

  var postSource = new PostSource(WindowsAdapter.path);
  Object.keys(postSource).forEach(function(key) {
    WindowsAdapter.prototype[key] = postSource[key];   
  });

  return WindowsAdapter;
};