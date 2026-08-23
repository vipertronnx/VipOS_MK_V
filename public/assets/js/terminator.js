socket.on('terminator', function () {
  document.querySelector("#red-background").style.display = "block";
  cycleLeftTable();
  cycleCenterTable();
  setTimeout(function(){
    for(element of ltChildren) { element.style.display = "none"; }
    for(element of ctChildren) { element.style.display = "none"; }
    document.querySelector("#red-background").style.display = "none";
  }, 5500)
});

var ltCounter;
var ctCounter;
var leftTable = document.querySelector("#left-table");
var ltChildren = leftTable.children[0].children;
var centerTable = document.querySelector("#center-table");
var ctChildren = centerTable.children[0].children;


function cycleLeftTable() {
  ltCounter = 0;
  cycleLeftRow();
}

function cycleLeftRow(stop = false) {
  setTimeout(function() {
    ltChildren[ltCounter].style.display = "table-row";
    ltCounter++;
    if (ltCounter < ltChildren.length) {
      cycleLeftRow(stop);
    } else {
      if(!stop) {
        ltCounter = 0;
        flashLeftTable();
      }
    }
  }, 30)
}

function flashLeftTable() {
  setTimeout(function() {
    if (leftTable.style.display === "none") {
      leftTable.style.display = "table";
    } else {
      leftTable.style.display = "none";
    }
    ltCounter++;
    if (ltCounter < 30) {
      flashLeftTable();
    } else {
      for(element of ltChildren) {
        element.style.display = "none";
      }
      ltCounter = 0;
      cycleLeftRow(true);
    }
  }, 50)
}

/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - */

function cycleCenterTable() {
  ctCounter = 0;
  cycleCenterRow();
}


function cycleCenterRow() {
  setTimeout(function() {
    ctChildren[ctCounter].style.display = "table-row";
    ctCounter++;
    if (ctCounter < ctChildren.length) {
      cycleCenterRow();
    } else {
      ctCounter = 0;
      flashCenterTable();
    }
  }, 250)
}


function flashCenterTable() {
  setTimeout(function() {
    if (centerTable.style.display === "none") {
      centerTable.style.display = "table";
    } else {
      centerTable.style.display = "none";
    }
    ctCounter++;
    if (ctCounter < 20) {
      flashCenterTable();
    }
  }, 100)
}