#!/usr/bin/env node

var yargs = require("yargs/yargs");
var opcua = require("node-opcua");
var PythonShell = require("python-shell");
var web3 = require("web3");
var os = require("os");
var fs = require("fs");

process.title = "OPCUA-Server for Joy-It Robotarm Robot02";

// Command-Lines Option Names
var portOption = "port";
var applicationNameOption = "applicationName";
var whisperPasswordOption = "whisperPassword";
var whisperTopicOption = "whisperTopic";
var pythonScriptOption = "python";
var updateIntervalOption = "updateInterval";
var webSocketUriOption = "webSocketUri";
var servoCountOption = "servoCount";
var printPythonConsoleOption = "printPythonConsole";
var historyFileOption = "historyFile";

// OPCUA-Eventnames
var opcua_post_initialize = "post_initialize";
var opcua_response = "response";
var opcua_request = "request";

// Python-Shell-Eventnames
var python_message = "message";
var python_close = "close";
var python_error = "error";

// OPCUA-Namespaces
var OPCUAServer = opcua.OPCUAServer;
var OPCUAClient = opcua.OPCUAClient;
var Variant = opcua.Variant;
var DataType = opcua.DataType;
var VariantArrayType = opcua.VariantArrayType;
var StatusCodes = opcua.StatusCodes;
var AttributeIds = opcua.AttributeIds;

// Web3-Variables
var webSocketUri;
var webSocket;
var symKeyId;
var whisperPassword;
var whisperTopic;

// Python-Variables
var pythonScript;
var printPythonConsole;
var pythonOptions = {
    mode: "text",
    pythonOptions: ["-u"],
    args:[]
};

// OPCUA-Variables
var applicationName;
var port;
var servoCount;
var servos;
var server;
var client;
var session;

// History file name
var historyFileName;

// Parsing Command-Line-Options
var argv = yargs(process.argv)
    .wrap(80)
    .help(true)

    .demandOption([portOption])
    .describe(portOption, "On which port to list for incomming connections.")
    .alias("p", portOption)

    .demandOption([pythonScriptOption])
    .describe(pythonScriptOption, "Which python file to execute.")
    .alias("y", pythonScriptOption)

    .demandOption([updateIntervalOption])
    .describe(updateIntervalOption, "At which interval the variables in the OPCUA-Server for the servos should be updated. In ms.")
    .alias("i", updateIntervalOption)

    .demandOption([webSocketUriOption])
    .describe(webSocketUriOption, "The URI to an ethereum-node websocket.")
    .alias("w", webSocketUriOption)

    .string(applicationNameOption)
    .describe(applicationNameOption, "Name of the application")
    .alias("a", applicationNameOption)
    .default(applicationNameOption, "Robotarm OPCUA-Server")

    .string(whisperPasswordOption)
    .describe(whisperPasswordOption, "Password decrypting incoming whisper messages.")
    .alias("x", whisperPasswordOption)
    .default(whisperPasswordOption, "password")

    .string(whisperTopicOption)
    .describe(whisperTopicOption, "Topic of whisper messages to listen to.")
    .alias("t", whisperTopicOption)
    .default(whisperTopicOption, "0x12345678")

    .number(servoCountOption)
    .describe(servoCountOption, "Count of servos for the OPCUA-Server to manage")
    .alias("s", servoCountOption)
    .default(servoCountOption, 6)

    .boolean(printPythonConsoleOption)
    .describe(printPythonConsoleOption, "True, if python console outputs should be printed in the nodejs-console")
    .alias("c", printPythonConsoleOption)
    .default(printPythonConsoleOption, false)

    .string(historyFileOption)
    .describe(historyFileOption, "The file to write history entrys to.")
    .alias("h", historyFileOption)
    .default(historyFileOption, "robotOpcuaHistory")

    .version("1.0")
    .argv;

//#####################################
//###Functions and methods for OPCUA###
//#####################################

// Helper method, that requests the servo value of the given servo index.
function updateServoValue(servoIndex){
    args = ["--Servo=" + (servoIndex+1), "--Method=read"];
    var script = runPythonScript(args);
    
    script.on(python_message, function(message){
	logAndWrite("OPCUA: Servo" + (servoIndex+1) + " updated: " + message);
	servos[servoIndex] = parseFloat(message);
    });
}

// Method, that updates all servo values of the OPCUA server by asking the controller software for each one individually.
function updateServoValues(){
    for( var i = 0; i < servoCount; i++){
	updateServoValue(i);
    }
}

// Reads the servo value of the given servoindex from a saved array. The actual values are getting requested in a certain intervall.
function getServo(servoIndex){
    return servos[servoIndex];
}

// Set servo value. Calls controllersoftware to set the physical servo to the given value.
function setServo(servoIndex, servoValue){
    args = ["--Servo=" + (servoIndex+1), "--Method=write", "--Value=" + servoValue];
    var script = runPythonScript(args);
    return script;
}

// Helper method, that adds a OPCUA variable to the OPCUA server of the given addressSpace, that represents the value of a servo.
// robot is the nodeID of the robotarm.
function addOPCUAServoVariable(servoIndex, addressSpace, robot){
    
    return addressSpace.addVariable({
	organizedBy: robot,
	browseName: "Servo" + (servoIndex+1),
	nodeId: "ns=1;s=Servo" + (servoIndex+1),
	dataType: "Float",
	value: {
	    get: function(){
		logAndWrite("OPCUA: Value of servo " + servoIndex + " requested.");
		var result = new Variant({dataType: DataType.Float, value: getServo(servoIndex)});
		return result;
	    },
	    set: function(variant){
		var value = parseFloat(variant.value);
		logAndWrite("OPCUA: Servo " + servoIndex + " changed to " + value);
		setServo(servoIndex, value);
		return StatusCodes.Good;
	    }
	}
    });
}

// Moves arm to the default position.
function moveArmToInitialPosition(){
    var servoIndex = 0;
    var moveFunc = function(err, script){
	servoIndex++;
	if(servoIndex < servoCount)
	    setServo(servoIndex, 1.5).on(python_close, moveFunc);
    }

    setServo(servoIndex, 1.5).on(python_close, moveFunc);
}

// OPCUA server method
// Gets calles as the last step of initializing a OPCUA server.
// Defines the published OPCUA variables and methods. Creates a OPCUA client that connects to the initialized server afterwards.
function opcuaServerPostInitialize(){
    var addressSpace = server.engine.addressSpace;

    var robot = addressSpace.addFolder(addressSpace.rootFolder.objects, {browseName: "Robot02"});

    var opcua_servos = [];

    // Add OPCUA-Variable fo every servo of the robot arm
    for(var i = 0; i < servoCount; i++)
	opcua_servos[i] = addOPCUAServoVariable(i, addressSpace, robot);

    
    // Prepare adding method to OPCUA-Server
    var method = addressSpace.addMethod(robot, {
	nodeId: "ns=1;s=loadFile",
	description: "Tries to load a recorded robot movement and plays it.",
	browseName: "loadFile",
	inputArguments: [{
	    name: "fileName",
	    description: {text: "path to file to load and play."},
	    dataType: DataType.String
	}],
	outputArguments: []
    });

    //Add OPCUA-Method
    method.bindMethod(function(inputArguments, context, callback){
	var callMethodResult = {
	    statusCode: StatusCodes.Good,
	    outputArguments:[]
	};

	var file = inputArguments[0].value;
	logAndWrite("OPCUA: Command received to load file " + file);
	logAndWrite("OPCUA: Call pythonscript to load and play file");
	playFile(file);
	callback(null, callMethodResult);
    });

    logAndWrite("OPCUA: Server successfully initialized.");

    initializeOpcuaClient();    
}

// OPCUA client method
// Gets called when a opcua client has successfully connected to a OPCUA server. Creates a session, after sucsessfully connecting to a server.
function onClientConnected(err){
    if(err){
	logAndWrite(err.toString().red);
	process.exit(-1);
    }
    client.createSession(onSessionCreated);
}

// OPCUA client method
// Gets called after a session has been successfully created. Saves the given session to a global variables for further use.
function onSessionCreated(err, sess){
    if(err){
	logAndWrite(err.toString().red);
	process.exit(-1);
    }
    else{
	session = sess;
    }
}

// OPCUA client method
// Initializues a OPCUA client, that connects to the locally running OPCUA server, to read and write variables, and call methods.
function initializeOpcuaClient(){
    client = new OPCUAClient({keepSessionAlive:true});
    client.connect("opc.tcp://" + os.hostname() + ":" + port, onClientConnected);
}

// OPCUA client method
// Reads a opcua variable from the server
function readOpcuaVariable(nodeId, callback){
    var nodeToRead = { nodeId: nodeId,
		       atributeId: AttributeIds.Value}
    session.read(noteToRead, 0, callback);
}

// OPCUA-client method
// Changes a variable of the OPCUA server. The nodeid and datatype have to be the same value, with whom they were defined.
function writeOpcuaVariable(nodeId, dataType, value, callback){
    var noteToWrite = { nodeId: nodeId,
			attributeId: AttributeIds.Value,
			value: {
			    statusCode: StatusCodes.Good,
			    value: {
				dataType: dataType,
				value: value
			    }
			}
		      }
    
    session.write(nodeToWrite, callback);
}

// OPCUA-client method
// Calls a opcua method of this server. The nodeId has to be the same id, with whom the method was defined
function callOpcuaMethod(nodeId, args, callback){
    var methodCallRequest = {
	objectId: "ns=1;i=1000", // Node ID of the robot arm
	methodId: nodeId,
	inputArguments: args
    };
    
    session.call(methodCallRequest, callback);
}

//####################################
//###Functions and methods for web3###
//####################################

// Gets called when a whisper message is posted.
function onWhisperMessagePosted(error, result){
    if(error){
	logAndWrite("WHISPER: " + error.toString().red);
	return
    }
}

// Gets called when a whisper message is received. Define behaviour for received message here.
function onWhisperMessageReceived(error, message, subscription){
    if(error){
	logAndWrite("WHISPER: " + error.toString().red);
	return;
    }

    sMessage = webSocket.utils.hexToString(message.payload);
    logAndWrite(("WHISPER: WhisperMessage received: " + sMessage).green);
    
    if(sMessage.startsWith("File=") && sMessage.length > "File=".length){
	logAndWrite(("WHISPER: Command received: " + sMessage).green);
	file = sMessage.split("=")[1];
	logAndWrite(("Call OPCUA-Method to load file " + file).green);
	var inputArgument = [{
	    dataType: DataType.String,
	    arrayType: VariantArrayType.Scalar, 
	    value: file
	}];
	callOpcuaMethod("ns=1;s=loadFile", inputArgument, function(err, result){
	    if(err) logAndWrite(err.toString().red);
	    else logAndWrite(result.toString().green);
	});
    }	       
}

// Connect to a geth client with the given websocket uri
// Whisper-messages are ONLY provided over a websocket
function connectToEthNode(wsUri){
    webSocket = new web3(new web3.providers.WebsocketProvider(wsUri));
}

// Sets password to decrypt whiser messages. Only whisper messages with a fitting password are received. However, all whisper messages are redirected.
function setPassword(password, callback){
    webSocket.shh.generateSymKeyFromPassword(password, callback);
}

// Subscribes to a whisper topic. Only topics the whisper client listens to are received. However, all whisper messages are redirected.
function subscribe(symKeyId, topic){
    var subscribeObject = {symKeyID: symKeyId, topics: [topic]};
    webSocket.shh.subscribe("messages", subscribeObject, onWhisperMessageReceived);
}

// Posts a whispermessage
function post(symKeyId, topic, message){

    var hexMessage = websocket.utils.toHex(message);
    
    var postObject = {symKeyID: symKeyId,
		      topic: topic,
		      powTarget: 1.0,
		      powTime: 10,
		      payload: hexMessage};

    return webSocket.shh.post(postObject, onWhisperMessagePosted);
}

function initializeWhisperListener(password, topic){
    logAndWrite(("WHISPER: Connect to websocket: " + webSocketUri).green);
    connectToEthNode(webSocketUri);
    setPassword(password, function(err, id){
	if(err){
	    logAndWrite(err.toString().red);
	    exit(-1);
	}
	logAndWrite(("WHISPER: Whisper-password successfully set. KeyId: " + id).green);
	symKeyId = id;
	logAndWrite(("WHISPER: Subscribe to topic " + topic).green);
	subscribe(symKeyId, topic);
    });
    
}

//############################################
//###Functions and methods for python-shell###
//############################################

// Gets called when the called python scripts prints a message to the console.
function onPythonMessage(message, script){
    if(printPythonConsole){
	var python = "PYTHON: " + message;
	logAndWrite(python.cyan);
    }
}

// Gets called when the called python script runs into an error.
function onPythonError(err, script){
    logAndWrite(("PYTHON: " + err.toString()).red);
}

// Gets called, when the called python script closed, with or without an error.
function onPythonClose(err, script){
    if(err) logAndWrite(("PYTHON: " + err.toString()).red);
    script.end(function(err, code, signal){onPythonEnd(err, code, signal, script)}); // After pythonsycript closed, end this object and free ressources
    
}

// Gets called when the python script has been called to end. 
function onPythonEnd(err, code, signal, script){
    if(err) logAndWrite(("PYTHON: " + err.toString()).red);
}

// Starts the python script with the cli --File=<fileName>. This should play a previously recorded file for the robot arm.
function playFile(fileName){
    // Starts the pythonscript with the --File= option
    args = ["--File=" + fileName];
    runPythonScript(args);
}

// Runs the python script with the given arguments.    
function runPythonScript(args){
    pythonOptions.args = args;
    
    var script = new PythonShell(pythonScript, pythonOptions);
    script.on(python_message, function(message){onPythonMessage(message, script)}); // Gets called when pythonscript prints something to console
    script.on(python_error, function(err){onPythonError(err, script)}); // Gets called when pythonscript encounters an error
    script.on(python_close, function(err){onPythonClose(err, script)}); // Gets called when pythonscript closed
    return script;
}

// Logs an entry to the console and writes it to the history file.
function logAndWrite(entry){
    console.log(entry);
    writeHistoryEntry(entry);
}

// Writes an entry to the histolry file.
function writeHistoryEntry(entry){
    var date = new Date();
    entry = date + ": " + entry + "\r\n";
    fs.appendFile(historyFileName, entry, function(err){
	if(err)
	    console.log("Unable to write history file. Maybe missing privileges?".red);
    });
}

// Save the cli options to global variables.
function getCLIArguments(){
    port = argv.port;
    applicationName = argv.applicationName;
    pythonScript = argv.python;
    webSocketUri = argv.webSocketUri;
    servoCount = argv.servoCount;
    updateInterval = argv.updateInterval
    printPythonConsole = argv.printPythonConsole;
    whisperPassword = argv.whisperPassword;
    whisperTopic = argv.whisperTopic;
    historyFileName = argv.historyFile;
}

// main method.
function main(){
    getCLIArguments();
    servos = [];

    for(var i = 0; i < servoCount; i++)
	servos[i] = 1.5; // Set servos to default values

    var servoValueUpdater = setInterval(updateServoValues, updateInterval); // Set intervall for updating OPCUA-Variables of the servo motors

    var server_options = {
	port: port,
	serverInfo: {
	    applicationName: {text: applicationName, locale: "de"}
	}
    }

    server = new OPCUAServer(server_options);

    server.on(opcua_post_initialize, opcuaServerPostInitialize);

    server.start(function (err) {
	if(err){
	    logAndWrite("Server failed to start ... exiting");
	    logAndWrite(err.toString().red);
	    process.exit(-3);
	}
    });

    moveArmToInitialPosition()
    initializeWhisperListener(whisperPassword, whisperTopic);
}

main();
