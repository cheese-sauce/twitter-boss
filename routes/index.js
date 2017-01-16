var express = require('express');
var router = express.Router();
var https = require('https');
var http = require('http');
var socket_io = require('socket.io')();
var AWS = require('aws-sdk');
//After realising we had no computational load with Alchemy
//Figured we'd include natural as well
var natural = require('natural');

var alchemyKeys = [
  '890588f81d1cd875017816331db45e770ab3c419',
  'd6ed816f9e6a6f34045913ad2042fd6d239ae218',
  'e746c7dd91c260f259390108ac4cd1c38d7f73bc',
  'a610c8157c836750376f829787140c230370d33b'
];

//Grab the API Modules
var twitter = require('twitter');
//Prepare the twitter and client
var twitterClient = new twitter({
  consumer_key: 'KA6Ybx1g8smex8csK8JmlpSRg',
  consumer_secret: 'nlM44N0nUbNZi7nUEI9cIieMEA3j8S5uYgEy3YznT9S973r351',
  access_token_key: '769323788500467712-adFvyZi2AuTnvzLIgpAJrG3KVGcAgKM',
  access_token_secret: '5YTFMNmkD1ADrFjPrsLg9HkmTQATYaTTpZ8Wshs2AwJye'
});

var currentAlchemyIndex = 1; //This will dictate the first key used

//Now for some Alchemy
var watson = require('watson-developer-cloud'); //Alchemy is a part of IBM's Watson
var alchemy_language;
activateAlchemy(); //Activates the first Alchemy client on startup
var swapping = false;

//Activates a new alchemy client
function activateAlchemy(){
  swapping = true;
  //Initiate an alchemy client using the current alchemy index
  //to find a key from the array
  alchemy_language = watson.alchemy_language({
    api_key: alchemyKeys[currentAlchemyIndex]
  });
  //Increment the current index so next time a new key
  //is used
  if(currentAlchemyIndex < (alchemyKeys.length - 1)){
    currentAlchemyIndex++;
  }else{
    currentAlchemyIndex = 0;
  }
  //This stops multiple calls to this function by
  //waiting 5 seconds until the swap is complete
  setTimeout(function(){
    swapping = false; //When true nothing can call this function
  }, 5000);
}

//Construct the AWS EC2 Bucket
var s3 = new AWS.S3();
var bucket = "twitterBOSS";
s3.createBucket({Bucket: bucket}, function(){
  console.log("Created main bucket");
});

//Handles all of the processes apart from serving pages
function main (query, socket){
  //Creates a new bucket to manage this specific query
  s3.createBucket({Bucket: bucket + "/" + socket.id + "/" + query}, function(){});
  getLastWeeks(query, socket); //Grabs the last week's worth of tweets
  initiateTwitterStream(query, socket); //Initiates a live filter of tweets

}

//Creates a bucket for the given socket using it's ID as the name
function addSocketToBucket(socket){
  s3.createBucket({Bucket: bucket + '/' + socket.id}, function(){
    console.log("CREATED SOCKET BUCKET");
  });
}

//Deletes the given socket's bucket on disconnect
function deleteBucket(socket){
  s3.deleteBucket({Bucket: bucket + "/" + socket.id}, function(err, data){
    if(err){
      console.log(err);
    }
  });
}

//This functions takes a query, recieves 100 tweets from the last
//week instantly and then does work to the tweets and emits it back
//to the user socket
function getLastWeeks(query, socket){
  //initiate variables to track the average sentiment
  var count = 0;
  var totalScore = 0;
  var params ={
    q: query,
    count: 100 //The maximum count per page
  };
  //Begin by making a Twitter call using the query sent by the client
  twitterClient.get('search/tweets', params, function(error, tweets, response){
    //If an error occurs in the call
    if(error){
      console.log("ERROR" + error);
    }else{
      //For each tweet that has been found
      for (var i = 0, len = tweets.statuses.length; i < len; i++) {
        socket.tweets.old[socket.tweets.old.length] = tweets.statuses[i];
        count++;
        //Set the tweet data to the object
        var object = {
          text: tweets.statuses[i].text,
          user: tweets.statuses[i].user.screen_name,
          id: tweets.statuses[i].id,
          time: tweets.statuses[i].created_at,
          number: count
        };
        //Get the sentiment and entities for this tweet
        getSentimentAndEntity(object, function (response){
          if(response !== false){
            //If there is a sentiment returned
            if (response.sentimentScore !== undefined) {
              totalScore += parseFloat(response.sentimentScore);
            }
            //Calculate the average and fix it to 2 decimals for easy reading
            var average = (totalScore / object.number).toFixed(2);
            response.averageSentiment = average;
            //Determine the type of sentiment
            if(average > 0.2){
              response.averageType = "Positive";
            }else if (average < -0.2){
              response.averageType = "Negative";
            }else{
              response.averageType = "Neutral";
            }
            //Store the tweet
            socket.tweets[socket.tweets.length] = tweets.statuses[response.number];
            //Update the average sentiment
            socket.averageSentiment.new = average;
            //Set the total tweet Count
            response.tweetTotal = socket.tweets.old.length;
            //Manage the entities of the Last Week's tweets
            manageOldEntities(query, socket, response.entityList);
            //Finally emit the resulting object
            socket.emit('lastWeeks', response);
          }else{
            console.log("ERROR IN LAST WEEK");
          }

        });
      }
    }
  });
}

//Takes a tweet and retrieves the sentiment of the text
//and any entities found, adding these to the JS object
function getSentimentAndEntity(object, callback){
  object.entityList = [];//Initiate the objecy entity list
  //Initiate the parameters for alchemy
  var parameters = {
    extract: 'entities,doc-sentiment',
    text: object.text
  };
  //Send the text off to be analysed by Alchemy
  alchemy_language.combined(parameters, function (err, response) {
    var entities = "ENTITIES: ";//Initiate the entities string
    //If something goes wrong return false
    //The only reason for this would be spam tweets which are able
    //to be missed
    if (err) {
      //If the Alchemy has hit hte limit, swap to a new key
      //Note: we understand multi-key use tends to be frowned upon... sorry?
      if(err.statusInfo == 'daily-transaction-limit-exceeded' && !swapping){
        console.log()
        activateAlchemy();
      }
      callback(false);
    }else {
      //This simply either sets the sentiment that was received
      //or creates a default sentiment if none was retrieved
      if(response.docSentiment.score !== 'undefined'){
        object.sentimentScore = response.docSentiment.score;
      }else{
        object.sentimentScore = 0;
      }
      if(response.docSentiment.type !== 'undefined'){
        object.sentimentType = response.docSentiment.type;
      }else{
        object.sentimentType = "neutral";
      }

      //As long as entities were found this adds them to the "entities" variable
      //one by one, creating a simple string to be shown to the client
      if(response.entities !== 'undefined' && response.entities.length > 0){
        //For each entity
        for(var j = 0; j < response.entities.length; j++){
          //Add each entity to an array as well, for use in entity management
          object.entityList[object.entityList.length] = response.entities[j].text;
          //concatenate the entity into the string
          entities = entities.concat(response.entities[j].text + " || ");
        }
      //If no entities were found
      }else{
        entities = "ENTITIES: NONE";
      }
      //Set the entities variable to the object and return it
      object.entities = entities;
      callback(object);
    }
  });
}

//This function takes a query (i.e "#TRUMP") and activates a live filter against
//incoming tweets. Every time a tweet is made that includes the query it returns
//that tweet and it's information such as: Text, User, Datetime, ID etc.
//
//The tweet's data is stored into a JS Object which will eventually be
//Emitted to the correct socket. This happens after receiving the sentiment and
//Entities and calculating the overall average sentiment for the stream
//
//Storage of the tweet data is handled by the socket itself
function initiateTwitterStream(query, socket){
  //Initiate the stream
  twitterClient.stream('statuses/filter', {track: query},  function(stream) {
    console.log("STREAM RETURNED");
    //Track the number of tweets and total sentiment score
    var count = 0;
    var totalScore = 0;

    //When a tweet is received from the stream
    stream.on('data', function(tweet) {
      //Add the tweet to the database
      socket.tweets.new[socket.tweets.new.length] = tweet;
      //Add to the count
      count++;
      checkLoadTweets(tweet.text, socket, function(sheepValue) {
        //Initiate the JS Object and set the initial values from the tweet
        var object = {
          text: tweet.text,
          user: tweet.user.screen_name,
          id: tweet.id,
          time: tweet.created_at,
          sheepRating: sheepValue,
          number: count //This lets us know what number tweet this was
        };
        //Get the sentiment score and type
        getSentimentAndEntity(object, function (response) {
          //If no sentiment or entities could be found it would return false
          // and simply ignore the tweet (as it would be spam or similar)
          if (response !== false) {
            //Add to the score
            totalScore += parseFloat(response.sentimentScore);
            //Calculate the average, and round it to 2 decimals
            var average = (totalScore / count).toFixed(2);
            //Set the average score to the JS object
            response.averageSentiment = average;
            //Calculate whether the average sentiment is pos/neut/neg and
            //set that to the object
            if (average > 0.2) {
              response.averageType = "Positive";
            } else if (average < -0.2) {
              response.averageType = "Negative";
            } else {
              response.averageType = "Neutral";
            }
            //Set the total tweet Count
            response.tweetTotal = socket.tweets.new.length;
            //Finally push the new tweet out to the socket
            socket.emit('newTweet', response);
            //Store the tweet data
            socket.tweets[socket.tweets.length] = tweet;
            socket.averageSentiment.new = average;
            //Update the entity list with this tweets data
            manageNewEntities(query, socket, response.entityList);
          }
        });
      });
    });
    //If an error occurs log it
    stream.on('error', function(error) {
      console.log(error);
    });
    //if the client presses the end stream button
    //destroy this stream and set socket.active to false
    socket.on('endStream', function(){
      socket.active = false;
      stream.destroy();
    });
    //If the socket disconnect, destroy this stream
    //and set socket.active to false
    socket.on('disconnect', function(){
      socket.active = false;
      stream.destroy();
    });

  });
}

//This function takes a socket and initiates a set of streams which bypasses
//the sentiment and entity analysis so that a large quantity of tweets can be
//recieved without being limited by Alchemy
function startLoadStreams(socket){
  initiateLoadStream('y', socket);
  initiateLoadStream('e', socket);
  initiateLoadStream('a', socket);
  initiateLoadStream('h', socket);
  initiateLoadStream('b', socket);
  initiateLoadStream('o', socket);
  initiateLoadStream('i', socket);
  initiateLoadStream('!', socket);
}

//Checks a load tweet against each of last week's tweets
//to see how similar it is on average... i.e the "Sheep Rating"
//This is designed to create load on the server for scaling purposes
function checkLoadTweets(tweet, socket, callback){
  var sheepRating;
  var sheepTotal = 0;
  for(var i = 0; i < socket.tweets.old.length; i++){
    sheepTotal += natural.JaroWinklerDistance(tweet, socket.tweets.old[i].text)
    if(i == socket.tweets.old.length -1){
      //Create a 4 decimal place average
      sheepRating = (sheepTotal/ socket.tweets.old.length).toFixed(4);
      //Convert it to a percentage with two decimals
      sheepRating *= 100;
      callback(sheepRating);
    }
  }
}
//This function creates a twitter of stream using the single character
//queries given by the loading function. This is designed to increase
//load for fun and see a massive influx of tweets
function initiateLoadStream(query, socket){
  //Initiate the stream
  twitterClient.stream('statuses/filter', {track: query},  function(stream) {
    var count = 0;
    //When a tweet is received from the stream
    stream.on('data', function(tweet) {
      count++;
      checkLoadTweets(tweet.text, socket, function(sheepValue){
        //There is a chance of the username being undefined, so it's best to skip them
        if(tweet.user.screen_name != undefined) {
          //Initiate the JS Object and set the initial values from the tweet
          var object = {
            text: tweet.text,
            user: tweet.user.screen_name,
            id: tweet.id,
            time: tweet.created_at,
            sheepRating: sheepValue,
            number: count //This lets us know what number tweet this was
          };
          socket.emit('loadTweet', object);
        }
      });


    });
    //If an error occurs log it
    stream.on('error', function(error) {
      console.log(error);
    });
    //if the client presses the end stream button
    //destroy this stream and set socket.active to false
    socket.on('endStream', function(){
      socket.active = false;
      stream.destroy();
    });
    //If the socket disconnect, destroy this stream
    //and set socket.active to false
    socket.on('disconnect', function(){
      socket.active = false;
      stream.destroy();
    });

  });
}


//This function takes the entities from a single "Last Week" tweet and
//manages them into the entity list stored within the socket object
//
// It either adds the entity to the list if this is it's first instance or
//increases the counter of the existing instance.
//
// On top of this it manages the top 10 most common entities, by grabbing the
// least common "TOP 10" entity and seeing whether the current entity is more common than
// that one. If so it replaces it. Note: if the entity is in the top list it just increments
function manageOldEntities(stream, socket, entities){
  //For each entity in the tweet
  for (var j = 0; j < entities.length; j++){
    //Convert it to the same case
    var entity = entities[j].toLowerCase();
    //If this entity is the one that's being streamed we aren't interested
    if(entity != stream.toLowerCase()) {
      //If this entity has already been added to the list
      if(socket.entities.old.list[entity] != undefined) {
        //Increment it's value
        socket.entities.old.list[entities[j]]++;
        //See whether it is in the top 10 list already
        checkIfInList(socket.entities.old.top, entity, function (result, location) {
          if (result) { //It's in the top list
            //Increment it
            socket.entities.old.top[location].value++;
          } else { //It's not in the top list
            //Find the lowest Top 10 entity
            getLowestIndex(socket.entities.old.top, function(index, value){
              //If this one is more common than the lowest
              if (socket.entities.old.list[entity] > value) {
                //Replace the old one with this one
                socket.entities.old.top[index] = {
                  value: socket.entities.old.list[entity],
                  name: entity
                };
              }
            });
          }
        });
      //If this is the first instance of the entity
      } else {
        //Create an entry
        socket.entities.old.list[entity] = 1;
        //Check whether the Top 10 list has been filled yet
        if (socket.entities.old.top.length < 10) {
          //Add it to the top 10 list
          socket.entities.old.top[socket.entities.old.top.length] = {
            name: entity,
            value: 1
          };
        }
      }
    }
  }
}


//This function takes the entities from a single live stream tweet and
//manages them into the entity list stored within the socket object
//
// It either adds the entity to the list if this is it's first instance or
//increases the counter of the existing instance.
//
// On top of this it manages the top 10 most common entities, by grabbing the
// least common "TOP 10" entity and seeing whether the current entity is more common than
// that one. If so it replaces it. Note: if the entity is in the top list it just increments
function manageNewEntities(stream, socket, entities){
  //For each entity in the tweet
  for (var j = 0; j < entities.length; j++){
    //Convert it to the same case
    var entity = entities[j].toLowerCase();
    //If this entity is the one that's being streamed we aren't interested
    if(entity != stream.toLowerCase()) {
      //If this entity has already been added to the list
      if(socket.entities.new.list[entity] != undefined) {
        //Increment it's value
        socket.entities.new.list[entities[j]]++;
        //See whether it is in the top 10 list already
        checkIfInList(socket.entities.new.top, entity, function (result, location) {
          if (result) { //It's in the top list
            //Increment it
            socket.entities.new.top[location].value++;
          } else { //It's not in the top list
            //Find the lowest Top 10 entity
            getLowestIndex(socket.entities.new.top, function(index, value){
              //If this one is more common than the lowest
              if (socket.entities.new.list[entity] > value) {
                //Replace the old one with this one
                socket.entities.new.top[index] = {
                  value: socket.entities.new.list[entity],
                  name: entity
                };
              }
            });
          }
        });
        //If this is the first instance of the entity
      } else {
        //Create an entry
        socket.entities.new.list[entity] = 1;
        //Check whether the Top 10 list has been filled yet
        if (socket.entities.new.top.length < 10) {
          //Add it to the top 10 list
          socket.entities.new.top[socket.entities.new.top.length] = {
            name: entity,
            value: 1
          };
        }
      }
    }
  }
}

//This takes a list and a string and checks whether
//that string is one of the values in the Top 10 List
function checkIfInList(list, entity, callback){
  //For each item in the list
  for (var i = 0; i < list.length; i++) {
    //If the entity string matches that items name
    if (entity == list[i].name) {
      //return true and give the index of that item
      callback(true, i);
    //Else if this is the last item in the list
    } else if (i == list.length - 1) {
      //Return false
      callback(false, 0);
    }
  }
}

//Takes a list and returns the index and value of the
// lowest valued item in that list
function getLowestIndex(list, callback) {
  //Set the defaults from the list's first item
  var entityValue = list[0].value;
  var entityIndex = 0;
  //For each item after that
  for (var i = 1; i < list.length; i++) {
    //If it's value is lower than the indexed
    //value replace it
    if (list[i].value < entityValue) {
      entityValue = list[i].value;
      entityIndex = i;
    }
    //If the last item has been checked return the values
    if (i == list.length - 1) {
      callback(entityIndex, entityValue);
    }
  }
}

//This function simply initiates some extra variables
//that will be stored within each socket
function setupSocket(socket){
  //socket.streams = {}; //Was for managing streams seperately
  socket.active = true; //Tracks whether streams are active
  //Manages all the entities for the streams
  socket.entities = {
    old: { //From last week
      top: [], //Top 10
      list: [] //All of the entities
    },
    new: { //From the live stream
      top: [],
      list: []
    }
  };
  //Tracks the average sentiment of both live and last week
  //Not currently used
  socket.averageSentiment = {
    old: 0,
    new: 0
    };
  //Stores all the tweets from the streams
  socket.tweets = {
      old: [],
      new: []
  };
}

module.exports = router;

//This section has access to the socket.io handler that is initiated from
//other locations, some aspects can be passed out such as the socket_io
//to be used for emitting but listening for sockets must be used
//inside the "io.on()" function which tracks each socket
module.exports = function(io) {
  var app = require('express');
  var router = app.Router();
  //Set up the external handler for emitting
  socket_io = io;
  //Set up the home page serving function
  router.get('/', function (appReq, appRes) {
    if(appReq.query.streaming == null){//Serve the Home page if no query is set
      console.log("INDEX");
      appRes.render('index');
      appRes.end();
    }else{ //Serve the search page
      console.log("RENDER");
      appRes.render('search');
      appRes.end();
    }
  });

  //This recognises when a user has opened the application and
  //receives that user's unique "socket"
  //This is also able to be handled in "app.js"
  //
  //NOTE: this could pass the unique socket into an external function
  socket_io.on('connection', function(socket) {
    addSocketToBucket(socket);
    //Set up the socket
    setupSocket(socket);
    //This listens for the disconnect
    socket.on('disconnect', function(){
      deleteBucket(socket);
    });
    //This is a listener that waits for this unique socket to emit additional tweet query data
    socket.on('addTweet', function (data) {
      //Start a stream with the new query parameter and the ID of this socket
      main(data, socket);
    });
    //This is a listener that waits for this unique socket to emit it's first tweet query
    socket.on('firstTweet', function(data){
      //Start a stream with the new query parameter and the ID of this socket
      main(data, socket);
    });
    //This is a listener that adds the top entities to streams
    socket.on('addEntities', function(){
      //For each item in the Live Stream Top 10 entity list
      for(var i = 0; i < socket.entities.new.top.length; i++){
        //Start a stream with the new query parameter and the ID of this socket
        main(socket.entities.new.top[i].name, socket);
      }
      //For each item in the Lsat week Top 10 entity list
      for(var j = 0; j < socket.entities.new.top.length; j++){
        //Start a stream with the new query parameter and the ID of this socket
        main(socket.entities.old.top[j].name, socket);
      }
    });
    //This is a listener that creates a massive tweet load for scaling
    socket.on('loadMe', function(){
      startLoadStreams(socket);
    });
    //Starts a 3 second emitter which updates the client's Top 10 entity list
    setInterval(function(){
      //If the streams are still active
      if(socket.active) {
        //Emit the old and new top 10 lists
        socket.emit('updateOldEntities', socket.entities.old.top);
        socket.emit('updateNewEntities', socket.entities.new.top);
      }
    }, 3000);
  });
  return router;
};
