//--------------------------------------------------------------------------------------------------
//
//
//--------------------------------------------------------------------------------------------------

const wmsUtil      = require('./wms-vb-wmsutil.js')
const DELAY_MSG_PROC = 5;

const defaultSettings = Object.freeze({
  autoOpen: true
})

var log;

//--------------------------------------------------------------------------------------------------
function getLogger(){
	return log;
}


//--------------------------------------------------------------------------------------------------
function privateCmdQueueEnqueue( stickObj, wmsMsg, onEnd, priority ){
	wmsMsg.stickObj = stickObj;
	wmsMsg.queuedTs = new Date();
	wmsMsg.onEnd = onEnd;
	
	if( priority === "priority" ){
		stickObj.wmsMsgQueue.unshift( wmsMsg );
		log.T( "Enqueued (priotity): "+wmsMsg.msgType+" "+wmsMsg.snr+" params: "+JSON.stringify(wmsMsg.params) );
	}
	else{
		stickObj.wmsMsgQueue.push( wmsMsg );
		log.T( "Enqueued: "+wmsMsg.msgType+" "+wmsMsg.snr+" params: "+JSON.stringify(wmsMsg.params) );
	}
}

//--------------------------------------------------------------------------------------------------
function privateCmdQueueRemove( stickObj, msgType, snr ){
	var countRemoved = 0;
	var i = 0;
	while( i < stickObj.wmsMsgQueue.length ){
		if( ( ( stickObj.wmsMsgQueue[i].msgType === msgType ) ||( !(msgType) ) ) && 
				( ( stickObj.wmsMsgQueue[i].snr === snr ) || ( snr = "000000" ) || ( !(snr) ) ) ){
			log.T( "privateCmdQueueRemove ["+i+"] "+stickObj.wmsMsgQueue[i].msgType+" "+stickObj.wmsMsgQueue[i].snr );
			stickObj.wmsMsgQueue.splice( i, 1 );
			countRemoved ++;
		}
		else
		{
			i++;
		}
	}
	return countRemoved;
}

//--------------------------------------------------------------------------------------------------
function privateCmdQueueHasMsg( stickObj, msgType, snr ){
	var hasMsg = false;
	var i = 0;
	log.T( "privateCmdQueueHasMsg "+msgType+" "+snr+" ?" );
	while( ( i < stickObj.wmsMsgQueue.length ) && hasMsg===false ){
		if( ( ( stickObj.wmsMsgQueue[i].msgType === msgType ) ||( !(msgType) ) ) && 
				( ( stickObj.wmsMsgQueue[i].snr === snr ) || ( snr = "000000" ) || ( !(snr) ) ) ){
			log.T( "privateCmdQueueHasMsg ["+i+"] "+stickObj.wmsMsgQueue[i].msgType+" "+stickObj.wmsMsgQueue[i].snr );
			hasMsg = true;
		}
		else
		{
			i++;
		}
	}
	return hasMsg;
}

//--------------------------------------------------------------------------------------------------
function privateCmdQueueClearExpects( stickObj ){
	if( stickObj.currentTimeout != undefined ){
		clearTimeout( stickObj.currentTimeout );
		stickObj.currentTimeout = undefined;
	}
	stickObj.currentWmsMsg = undefined;
}


//-------------------------------------------------------------------------------------------------- 
function privateStickSendMsg( stickObj, wmsCmd ){
	wmsCmd.comTs = new Date();
	log.D( "WMS-SND "+stickObj.name+": "+ wmsCmd.stickCmd.cmd );
	log.D( "MSG-SND "+stickObj.name+": "+ 	wmsCmd.msgType+" "+wmsCmd.snr+" "+JSON.stringify(wmsCmd.params) );
	
	stickObj.comDataSendCallback( wmsCmd.stickCmd.cmd );
}

//--------------------------------------------------------------------------------------------------
function privateCmdQueueProcess( stickObj ){
	// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
	function cmdQueueTimeoutHdlr(){
		if( stickObj.currentWmsMsg ){
			if( stickObj.currentWmsMsg.retry < 0 ){
				log.I( "wmsTimeout "+
								stickObj.currentWmsMsg.timeout+" "+
								stickObj.currentWmsMsg.msgType+" "+
								stickObj.currentWmsMsg.snr+" "+ 
								JSON.stringify( stickObj.currentWmsMsg.stickCmd.cmd )+"." );
				privateUpdateWmsComStatistics( stickObj, stickObj.currentWmsMsg.snr, "wmsTimeout" );
				if( stickObj.currentWmsMsg.onEnd ){
					stickObj.currentWmsMsg.onEnd( "timeout", stickObj.currentWmsMsg, null );
				}
			}
			else{
				log.I( "wmsRetry "+stickObj.currentWmsMsg.msgType+" "+stickObj.currentWmsMsg.snr+" "+ JSON.stringify( stickObj.currentWmsMsg.stickCmd.cmd )+"." );
				stickObj.currentWmsMsg.retry --;
				stickObj.wmsMsgQueue.push( stickObj.currentWmsMsg );

				privateUpdateWmsComStatistics( stickObj, stickObj.currentWmsMsg.snr, "wmsRetry" );
			}
			privateCmdQueueClearExpects( stickObj );
		}
		else
		{
			log.W( "cmdQueueTimeoutHdlr: Currently no MSG processing." );
		}

		setTimeout( function() { privateCmdQueueProcess(stickObj); } , DELAY_MSG_PROC );
	}
	// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

	if( stickObj.currentWmsMsg === undefined ){
		if( stickObj.wmsMsgQueue.length > 0 ){
			stickObj.currentWmsMsg = stickObj.wmsMsgQueue.shift();
			stickObj.currentTimeout = setTimeout( cmdQueueTimeoutHdlr, stickObj.currentWmsMsg.timeout );
			log.T( "privateCmdQueueProcess sending "+stickObj.currentWmsMsg.msgType+" "+stickObj.currentWmsMsg.snr+" "+ JSON.stringify( stickObj.currentWmsMsg.stickCmd.cmd )+"." );
			privateStickSendMsg( stickObj, stickObj.currentWmsMsg );
			privateUpdateWmsComStatistics( stickObj, stickObj.currentWmsMsg.snr, "wmsSent" );
		}
	}
	else{
		log.T( "wmsStick busy expecting "+ JSON.stringify( stickObj.currentWmsMsg.stickCmd.expect )+"." );
	}
}

//--------------------------------------------------------------------------------------------------
function privateHandleWmsCompletionGeneric( error, wmsMsgSent, wmsMsgRcv ){
	if( error ){
		log.D( wmsMsgSent.stickObj.name+" privateHandleWmsCompletionGeneric "+wmsMsgSent.msgType+" "+wmsMsgSent.snr+" Error: "+error );
	}
	else{
		log.T( wmsMsgSent.stickObj.name+" privateHandleWmsCompletionGeneric: "+wmsMsgSent.msgType+" "+wmsMsgSent.snr+": "+wmsMsgRcv.msgType );
	}
}

//--------------------------------------------------------------------------------------------------
function privateOnWmsMsgRcv( stickObj, wmsMsg ){
	log.D( "WMS-RCV "+stickObj.name+": "+ wmsMsg.stickCmd );
	log.D( "MSG-RCV "+stickObj.name+": "+ JSON.stringify( wmsMsg ) );

	// check if result is expected
	if( ( stickObj.currentWmsMsg != undefined ) && 
			( stickObj.currentWmsMsg.stickCmd != undefined ) && 
			( stickObj.currentWmsMsg.stickCmd.expect != undefined ) && 
			( stickObj.currentWmsMsg.stickCmd.expect.msgType === wmsMsg.msgType ) &&
			( ( stickObj.currentWmsMsg.stickCmd.expect.snr  === undefined ) || ( wmsMsg.snr === stickObj.currentWmsMsg.stickCmd.expect.snr ) ) ){
			
		nextMsgDelay = DELAY_MSG_PROC;
		log.T( "Received ecpected answer" );

		privateUpdateWmsComStatistics( stickObj, wmsMsg.snr, "wmsRecieved" );
		
		if( stickObj.currentWmsMsg.onEnd ){
			stickObj.currentWmsMsg.onEnd( ""/*error*/, stickObj.currentWmsMsg, wmsMsg );
		}
		else{
			log.W( stickObj.name+" No callback for expected MSG: " + JSON.stringify( wmsMsg ) );
		}
		if( stickObj.currentWmsMsg.delayAfter ){
			log.T( stickObj.name+" Delay after this msg: "+stickObj.currentWmsMsg.delayAfter );
			nextMsgDelay += stickObj.currentWmsMsg.delayAfter;
		}
		
 		setTimeout( function() { privateCmdQueueProcess(stickObj); }, nextMsgDelay );
		privateCmdQueueClearExpects( stickObj );
	}
	else{
		if( wmsMsg.msgType === "weatherBroadcast" ){
			stickObj.weather.snr    = wmsMsg.snrNum;
			stickObj.weather.snrHex = wmsMsg.snr;
			stickObj.weather.ts     = new Date();
			stickObj.weather.temp   = wmsMsg.params.temp;
			stickObj.weather.wind   = wmsMsg.params.wind;
			stickObj.weather.lumen  = wmsMsg.params.lumen;
			stickObj.weather.rain   = wmsMsg.params.rain;
			log.D( stickObj.name+" weatherBroadcast: "+ JSON.stringify( stickObj.weather ) );
			stickObj.callback( undefined, { topic:"wms-vb-rcv-weather-broadcast", payload: { weather:stickObj.weather } } );
		}
		else if( wmsMsg.msgType === "scanResponse" ){
			log.I( stickObj.name+" Scanned device: "+wmsMsg.snr+" Type "+wmsMsg.params.deviceType+" "+wmsMsg.params.deviceTypeStr );
			privateUpdateWmsComStatistics( stickObj, 0/*snr*/, "wmsRecieved" );
			
			device = privateGetScannedDevBySnrHex( stickObj, wmsMsg.snr );
			device.snr     = wmsMsg.snrNum;
			device.type    = wmsMsg.params.deviceType;
			device.typeStr = wmsMsg.params.deviceTypeStr;
		}
		else if( wmsMsg.msgType === "scanRequest" ){
			stickObj.callback( undefined, { topic:"wms-vb-rcv-scan-request", payload: { snr:wmsUtil.snrHexToNum( wmsMsg.snr ) } } );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "scanResponse", wmsMsg.snr, { panId: stickObj.panid } ), privateHandleWmsCompletionGeneric );
			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else if( wmsMsg.msgType === "switchChannelRequest" ){
			log.D( stickObj.name+" switchChannelRequest: "+JSON.stringify( wmsMsg.params ) );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "stickSwitchChannel", wmsMsg.snr, { channel:wmsMsg.params.channel , panId:wmsMsg.params.panId } ), privateHandleWmsCompletionGeneric );
			setTimeout( function() { privateCmdQueueProcess(stickObj) }, DELAY_MSG_PROC );
		}
		else if( wmsMsg.msgType === "joinNetworkRequest" ){
			log.D( "---------------------------------------------------------------------------------------------------------" );
			log.D( stickObj.name+" joinNetworkRequest: "+JSON.stringify( wmsMsg.params ) );
			log.D( "---------------------------------------------------------------------------------------------------------" );
			// {"panId":"01FF","networkKey":"1234567890ABCDEF5D6A4F707CBBC501","unknown":"FF","channel":17}
			stickObj.callback( undefined, { topic:"wms-vb-network-params", payload: { panId:wmsMsg.params.panId, networkKey:wmsMsg.params.networkKey, channel:wmsMsg.params.channel } } );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "ack", "000000", {}), privateHandleWmsCompletionGeneric );
 			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else if( wmsMsg.msgType === "waveRequest" ){
			stickObj.callback( undefined, { topic:"wms-vb-rcv-wave-request", payload: { snr:wmsUtil.snrHexToNum( wmsMsg.snr ) } } );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "ack", "000000", {}), privateHandleWmsCompletionGeneric );
 			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else if( ( wmsMsg.msgType != "ack" ) && ( wmsMsg.msgType != "fwd" ) ){			
			log.D( stickObj.name+" Received unexpected MSG: " + wmsMsg.msgType+" snr="+wmsMsg.snr );
			if( stickObj.currentWmsMsg != undefined ){ 
				log.D( stickObj.name+"         waiting for MSG: " + stickObj.currentWmsMsg.stickCmd.expect.msgType+" snr="+stickObj.currentWmsMsg.stickCmd.expect.snr );
			}
			else{ 
				log.D( stickObj.name+"      waiting for no MSG." );
			}
		}
	}
}

//--------------------------------------------------------------------------------------------------
function privateUpdateWmsComStatistics( stickObj, id, propertyStr, value ){
	log.T( "privateUpdateWmsComStatistics( ("+(typeof id)+") \""+id+"\", "+ propertyStr + ", "+ value+ " )" );
	
	// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
	function checkAndSetComStatistics( obj, propertyStr ){
		switch( propertyStr ){
			case "wmsSent":
			case "wmsRecieved":
			case "wmsRetry":
			case "wmsTimeout":
				counterStr = propertyStr+"Count";
				TsStr = propertyStr+"Ts";

				if( obj[counterStr] ){
					obj[counterStr] ++;
				}
				else{
					obj[counterStr] = 1;
				}
				obj[TsStr] = new Date();
				
				if( propertyStr === "wmsRecieved" ){
					obj.wmsComDuration += ( obj.wmsRecievedTs.getTime() - obj.wmsSentTs.getTime() );
					obj.wmsComMaxDuration = Math.max( obj.wmsComMaxDuration, obj.wmsRecievedTs.getTime() - obj.wmsSentTs.getTime() );
				}
				break;
			default:
				// Set property for blind
				if( blind ){
					blind[propertyStr] = value;
				}
				// Set property for stick
				stickObj[propertyStr] = value;
		}
	}
	// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
	
	var blind = stickObj.vnBlindGet( id );

	propertyStr = propertyStr.trim();
	// Set property for blind
	if( blind ){
		checkAndSetComStatistics( blind, propertyStr );
	}
	// Set property for stick
	checkAndSetComStatistics( stickObj, propertyStr );
}

//--------------------------------------------------------------------------------------------------
function privateGetScannedDevBySnrHex( stickObj, snrHex ){
	if( !stickObj.scannedDevUniqueObj[snrHex] ){
		stickObj.scannedDevUniqueObj[snrHex] = { 
					snr             : wmsUtil.snrHexToNum( snrHex ), 
					snrHex          : snrHex, 
					type            : "00", 
					typeStr         : "<unknown type>", 
				};
		log.T( "created device "+ JSON.stringify( stickObj.scannedDevUniqueObj[snrHex] ) );
	}
	return stickObj.scannedDevUniqueObj[snrHex];
}

//--------------------------------------------------------------------------------------------------
function privateFinishScannedDevices( stickObj, options ){
	function sortCompareFunction( a, b ){
		as = a.type+(100000000+a.snr) // snr 8 Stellen;
		bs = b.type+(100000000+b.snr);
		ret=as>bs?1:(as<bs?-1:0);
		return ret;
	}
	
	stickObj.scannedDevArray = [];
	for(var deviceSnr in stickObj.scannedDevUniqueObj ) {
		if( stickObj.scannedDevUniqueObj.hasOwnProperty( deviceSnr ) ) {
			stickObj.scannedDevArray.push( stickObj.scannedDevUniqueObj[deviceSnr] );
		}
	}
	stickObj.scannedDevArray.sort( sortCompareFunction );
	log.D( stickObj.name+" privateFinishScannedDevices: Scanned "+stickObj.scannedDevArray.length+" devices." );
	
	if( options ){
		if( options.autoAssignBlinds ){
			log.I( stickObj.name+" Assign scanned blinds to stick." );
			
			stickObj.vnBlinds = [];
			stickObj.scannedDevArray.forEach( function (device, index) { 
					if( ( device.type === '20' ) || ( device.type === '21' ) || ( device.type === '25' ) ){
						stickObj.vnBlindAdd( device.snr, device.typeStr.trim()+" "+device.snr+" ("+device.snrHex+")" );
						log.I( stickObj.name+"   Added "+device.typeStr.trim()+" "+device.snr+" ("+device.snrHex+")" );
					}
				} );
		}
	}

	privateCopyWmsStatistics( stickObj, stickObj.backupStatistics );
	stickObj.backupStatistics = undefined;
	stickObj.scanInProgress = undefined;
	stickObj.callback( undefined, { topic:"wms-vb-scanned-devices", payload: { devices:stickObj.scannedDevArray } } );
}

//--------------------------------------------------------------------------------------------------
function privateUpdateBlindPosWithCallback( blind, newPos, callbackFct, optionsPar ){

	const defaultOptions = Object.freeze({ callbackOnUnchangedPos:false });
	
	var options = Object.assign({}, defaultOptions, optionsPar );

	if( ( options.callbackOnUnchangedPos ) || 
			( !newPos.equals( blind.posCurrent ) ) ){
		blind.posCurrent = new VnBlindPos( newPos );

		if( callbackFct ){
			callbackFct( null/*err*/, { topic: "wms-vb-blind-position-update", 
				payload: { snr: blind.snr, snrHex: blind.snrHex, name: blind.name, 
				position:blind.posCurrent.pos, valance:blind.posCurrent.val, moving:blind.posCurrent.moving } } );
		}
	}
}

//--------------------------------------------------------------------------------------------------
function privateInitWmsStatistics( obj ){
	obj.wmsSentCount = 0;
	obj.wmsSentTs = new Date(0);
	obj.wmsRecievedCount = 0;
	obj.wmsRecievedTs = new Date(0);

	obj.wmsComDuration = 0;
	obj.wmsComMaxDuration = 0;

	obj.wmsRetryCount = 0;
	obj.wmsRetryTs = new Date(0);

	obj.wmsTimeoutCount = 0;
	obj.wmsTimeoutTs = new Date(0);
}

//--------------------------------------------------------------------------------------------------
function privateCopyWmsStatistics( objTo, objFrom ){
	objTo.wmsSentCount = objFrom.wmsSentCount;
	objTo.wmsSentTs = objFrom.wmsSentTs;
	objTo.wmsRecievedCount = objFrom.wmsRecievedCount;
	objTo.wmsRecievedTs = new Date( objFrom.wmsRecievedTs.getTime() );

	objTo.wmsComDuration = objFrom.wmsComDuration;
	objTo.wmsComMaxDuration = objFrom.wmsComMaxDuration;
	objTo.wmsComAvgDuration = Math.round( objFrom.wmsRecievedCount?(objFrom.wmsComDuration/objFrom.wmsRecievedCount):0 );

	objTo.wmsRetryCount = objFrom.wmsRetryCount;
	objTo.wmsRetryTs = new Date( objFrom.wmsRetryTs.getTime() );
	objTo.wmsRetryRate = objFrom.wmsSentCount?(objFrom.wmsRetryCount/objFrom.wmsSentCount):0;

	objTo.wmsTimeoutCount = objFrom.wmsTimeoutCount;
	objTo.wmsTimeoutTs = new Date( objFrom.wmsTimeoutTs.getTime() );
	objTo.wmsTimeoutRate = objFrom.wmsSentCount?(objFrom.wmsTimeoutCount/objFrom.wmsSentCount):0;
}

//--------------------------------------------------------------------------------------------------
// Classes
//--------------------------------------------------------------------------------------------------

//--------------------------------------------------------------------------------------------------
class VnBlindPos{
  constructor( pos, val, moving ){
		this.pos = NaN;
		this.val = NaN;
		this.moving = false;

		if( typeof pos === "object" )
		{
			this.pos = parseInt( pos.pos );
			this.val = parseInt( pos.val );
			this.moving = !!pos.moving; // !! converts anything to Boolean
		}
		else
		{
			this.pos = parseInt( pos );
			this.val = parseInt( val );
			this.moving = !!moving; // !! converts anything to Boolean
		}
	
		if( (this.pos === NaN ) || ( this.val === NaN ) ){
			throw "VnBlindPos: Constructor has to evaluate to VnBlindPos( <number pos>, <number val>, <boolean moving> ) or VnBlindPos( { pos:<number>, val:<number>, moving:<boolean> } ).";
		}

	}
	
	equals( pos, val, moving ){
		if( (typeof pos) === "number" ){
			ret = ( ( this.pos === pos ) && ( this.val === val ) && (this.moving === moving) );
		}
		else if( (typeof pos.pos) === "number" ){
			ret = ( ( this.pos === pos.pos ) && ( this.val === pos.val ) && ( this.moving === pos.moving ) );
		}
		return ret;
	}
};

//--------------------------------------------------------------------------------------------------
class WmsVbStick {
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
  constructor( name, channel, panid, key, optionsPar, callback, comDataSendCallback ){
		// Checks
		if( (typeof callback) != "function" ){
			throw "WmsVbStick: callback must be of type \"function\".";
		}
		if( ( (typeof comDataSendCallback) != "function" ) && ( comDataSendCallback != undefined ) ) {
			throw "WmsVbStick: comDataSendCallback must be of type \"function\" or undefined.";
		}
		// Attributes
		this.name = name; 
		this.status = "created"; // created init ready error
		this.channel = channel;
		this.panid = panid;
		this.key = key;
		this.options = Object.assign({}, defaultSettings, optionsPar );
		this.callback = callback;
		if( comDataSendCallback ){
			this.comDataSendCallback = comDataSendCallback; // function ( string );
		}
		this.vnBlinds = [];
		this.wmsMsgQueue = [];
		this.currentWmsMsg = undefined;
		this.currentTimeout = undefined;
		this.weather = {
				snr:0,
				snrHex: "000000",
				ts:new Date(0),
				temp:0,
				wind:0,
				lumen:0,
				rain:false
			};
		this.startupTs = new Date();
		this.scannedDevUniqueObj = {};
		this.scannedDevArray = [];
		this.posUpdIntervalTimer = undefined;
		this.posUpdIntervalMsec = 0;
		this.watchMovingIntervalTimer = undefined;
		this.watchMovingIntervalMsec = 0;
		this.enableCmdConfirmationNotification = false
		// this.setWatchMovingInterval( 200 );

		privateInitWmsStatistics( this );

		log.setLogLevel( "I" );

		// panid=FFFF -> get netwok paramters
		if( panid === "FFFF" ){
			const timeoutMsec = 180000;

			var stickObj = this;
			this.getNetworkParamsTimeout = setTimeout( function(){ stickObj.getNetworkParamsCallback( "timeout", { topic:"wms-vb-network-params-timeout", payload: { milliseconds: timeoutMsec } } ); }, timeoutMsec );

			this.getNetworkParamsCallbackSave = this.callback;
			this.callback = stickObj.getNetworkParamsCallback;
			log.setLogLevel( "I" );
		}
		
		log.addLogFile( "console", "I", ""/*fileWrap*/, "DHMSm l"/*prefixFormat*/, []/*filterArray*/ );
		//~ /*XXX*/log.addLogFile( "/home/ae/wms-all.log", "D", "D"/*fileWrap*/, "DHMSm l"/*prefixFormat*/, []/*filterArray*/ );
		//~ /*XXX*/log.addLogFile( "/home/ae/wms-com.log", "D", "D"/*fileWrap*/, "DHMSm l"/*prefixFormat*/, ["MSG-SND","MSG-RCV"]/*filterArray*/ );

	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	comDataReceive( data ){
		privateOnWmsMsgRcv( this, wmsUtil.decodeStickCmd( data ) );
	};
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	initWmsNetwork(){
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function initWmsMsgCompletion( error, wmsMsgSend, wmsMsgRcv ){
			privateHandleWmsCompletionGeneric( error, wmsMsgSend, wmsMsgRcv );
				
			if( ( !error ) || ( error === "timeout" ) ) {
				//~ if( error === "timeout" ) { // timeout is normal result of scan request when used
					//~ privateFinishScannedDevices( stickObj );
					//~ log.I( stickObj.name+" initWmsMsgCompletion completed with scanRequest." );
				//~ }
				//~ else{
					log.T( stickObj.name+" initWmsMsgCompletion "+wmsMsgSend.msgType );
				//~ }
				stickObj.status = "ready";
				privateInitWmsStatistics( stickObj );
				stickObj.callback( error, { topic: "wms-vb-init-completion", payload: { status: stickObj.status } } );
			}
			else if( error ){
				log.E( stickObj.name+" Error initWmsMsgCompletion "+wmsMsgSend.msgType+": "+error );
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

		var stickObj = this;
		privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "stickGetName", 0, {} ), privateHandleWmsCompletionGeneric );
		privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "stickGetVersion", 0, {} ), privateHandleWmsCompletionGeneric );
		privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( 'stickSetKey', 0, {key: stickObj.key } ), privateHandleWmsCompletionGeneric );
		privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "stickSwitchChannel", 0, {channel: stickObj.channel, panId: stickObj.panid} ), initWmsMsgCompletion );
		
		setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	getNetworkParamsCallback( err, msg ){
		var stickObj = this;
		
		const waveReqText = "*** Waving and Hello!";

		
		if( msg.topic === "wms-vb-init-completion" )
		{
			//     "12345678901234567890123456789012345678901234567890123456789012345678901234567890" );
			log.I( "--------------------------------------------------------------------------------" );
			log.I( "Starting getting network paramters..." );
			log.I( "- Open the battery case of the WMS Handheld transmitter." );
			log.I( "- Select the channel using the (+) button." );
			log.I( "  Notice: If an unassigned channel is selected, press the (+) button for 5 s." );
			log.I( "          As soon as the LED flashes, all channels can be selected by" );
			log.I( "          pressing the (+) button again" );
			log.I( "- Press the learn button in the battery case of the the WMS Handheld" );
			log.I( "  transmitter for approx. 5 s. LEDS go green; the transmission LED flashes." );
			log.I( "  For several seconds, the WMSHand-held transmitter plus scans the operating " );
			log.I( "  range for devices." );
			log.I( "- Each time when scanning stops with red LED perform steps:" );
			log.I( "  1)  When you press the control button (A), you can check WHICH target device" ); 
			log.I( "      was just found." );
			log.I( "  2) If you can *not* see the output" );
			log.I( "       \""+waveReqText+"\"" );
			log.I( "     on the screen after pressing (A) another device than the WMS Stick has" ); 
			log.I( "     been found. Press the (C) button to switch to the next receiver." );
			log.I( "  3) If you can see the output" );
			log.I( "       \""+waveReqText+"\"" );
			log.I( "     on the screen after pressing (A) then the WMS Stick has been found. " ); 
			log.I( "     Press the STOP button to assign the WMS Stick to the channel. After " );
			log.I( "     pressing STOP the network parameters are dislayed on the screen. " );
			log.I( "- Press Ctrl-C to abort." );
		}
		else if( msg.topic === "wms-vb-rcv-scan-request" )
		{
			log.I( "*** Stick scanned by SNR "+msg.payload.snr+"." );
		}
		else if( msg.topic === "wms-vb-rcv-wave-request" )
		{
			log.I( "*** "+waveReqText + " (requested from SNR "+msg.payload.snr+")" );
		}
		else if( msg.topic === "wms-vb-network-params" )
		{
			if( stickObj.status != "error" ){
				clearTimeout( stickObj.getNetworkParamsTimeout );
				log.I( "*** WMS Network parameters successfully detected:" );
				log.I( "    Channel: "+ msg.payload.channel );
				log.I( "    PanId:   "+ msg.payload.panId );
				log.I( "    Key:     "+ msg.payload.networkKey );
				log.I( "- Write down and remember the network parameters." );
				log.I( "- Briefly press the learn button on the back of WMS Handheld transmitter to" );
				log.I( "  stop the scanning process." );
				log.I( "- Press Ctrl-C to stop program." );
				log.I( "--------------------------------------------------------------------------------" );
				//     "12345678901234567890123456789012345678901234567890123456789012345678901234567890" );
				stickObj.status = "error";
			}
		}
		else if( msg.topic === "wms-vb-network-params-timeout" )
		{
			log.I( "Timeout occured detecting WMS network parameters." );
			log.I( "Please complete operation within "+msg.payload.milliseconds/60000 +" minutes." );
			log.I( "--------------------------------------------------------------------------------" );
			stickObj.status = "error";
		}
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	scanDevices( options ){
		var stickObj = this;
		
		if( stickObj.scanInProgress ){
			log.I( "Scanning already in progress" );
		}
		else{
			stickObj.scannedDevArray = [];
			stickObj.scannedDevUniqueObj = {};
			stickObj.backupStatistics = {};
			privateCopyWmsStatistics( stickObj.backupStatistics, stickObj );
			stickObj.scanInProgress = true;

			// Call several times since some devices don't answer the first scanRequest.
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "scanRequest", 0, { panId: stickObj.panid } ), privateHandleWmsCompletionGeneric );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "scanRequest", 0, { panId: stickObj.panid } ), privateHandleWmsCompletionGeneric );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "scanRequest", 0, { panId: stickObj.panid } ), function() { privateFinishScannedDevices( stickObj, options ); } );
			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindGetIdx( id ){ // id my be snr, snrHex or name of blind. Returns index or -1 if not found.
		var stickObj = this;
		var ret = -1;
		
		log.T( "vnBlindGetIdx( ("+(typeof id)+") \""+id+"\" )" );

		for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
			if( stickObj.vnBlinds[i].snr === id ){
				ret = i;
				i = stickObj.vnBlinds.length;
			}
			else if( stickObj.vnBlinds[i].snrHex === id ){
				ret = i;
				i = stickObj.vnBlinds.length;
			}
			else if( stickObj.vnBlinds[i].name === id ){
				ret = i;
				i = stickObj.vnBlinds.length;
			}
		}
		return ret;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindGet( id ){ // id my be snr, snrHex or name of blind
		var stickObj = this;
		var ret = undefined;
		var idx = stickObj.vnBlindGetIdx( id);
		
		if( idx >= 0 ){
			ret = stickObj.vnBlinds[idx];
		}

		return ret;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindAdd( snr, name ){
		var stickObj = this;
		
		log.T( "vnBlindAdd( "+snr+", "+name+" )" );
		
		if( stickObj.vnBlindGet( snr ) ){
			log.W( "vnBlindAdd: Blind with snr "+snr+" is already added." );
		}
		if( stickObj.vnBlindGet( name ) ){
			log.W( "vnBlindAdd: Blind with name \""+name+"\" is already added." );
		}

		var blind = {};
		blind.snr = snr;
		blind.snrHex = wmsUtil.snrNumToHex( snr );
		blind.name = name;
		blind.posRequested = new VnBlindPos( 0, 0, false/*moving*/ );
		blind.posCurrent = new VnBlindPos( -1, 0, false/*moving*/ );
		blind.creationTs = new Date();
		privateInitWmsStatistics( blind );

		stickObj.vnBlinds.push( blind );
		
		return blind;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindRemove( id ){
		log.D( "vnBlindRemove( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		var blind = stickObj.vnBlindGet( id );
				
		var countRemoved = 0;
		var i = 0;
		while( i < stickObj.vnBlinds.length ){
			
			if( ( !blind ) || ( stickObj.vnBlinds[i].snr === blind.snr ) ){
				log.D( "vnBlindRemove ["+i+"] "+
							stickObj.vnBlinds[i].snr+" "+
							stickObj.vnBlinds[i].snrHex+" "+
							stickObj.vnBlinds[i].name );
				privateCmdQueueRemove( stickObj, null/*msgType*/, stickObj.vnBlinds[i].snr );
				stickObj.vnBlinds.splice( i, 1 );
				countRemoved ++;
			}
			else
			{
				i++;
			}
		}
		return countRemoved;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindsList(){
		var stickObj = this;
		var ret = [];
		
		for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
			ret.push( { snr:stickObj.vnBlinds[i].snr, snrHex:stickObj.vnBlinds[i].snrHex, 
								name:stickObj.vnBlinds[i].name } );
		}
		return ret;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	getLastWeatherBroadcast(){
		var stickObj = this;
		return stickObj.weather;
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindGetStatus( id ){
		log.T( "vnBlindGetStatus( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		var ret = [];
		
		for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
			if( ( id === undefined ) || 
					( stickObj.vnBlinds[i] === stickObj.vnBlindGet( id ) ) ){
				ret.push( stickObj.vnBlinds[i] );
				privateCopyWmsStatistics( ret[ret.length-1], stickObj.vnBlinds[i] );
			}
		}

		return ret;
	};

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	getStatus(){
		log.T( "getStatus()" );
		var stickObj = this;
		var ret = { name              :stickObj.name,
					startupTs         :stickObj.startupTs,
					status            :stickObj.status,
					posUpdIntervalMsec:stickObj.posUpdIntervalMsec
				};
		privateCopyWmsStatistics( ret, stickObj );

		return ret;
	};

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	setWatchMovingBlindsInterval( intervalMsec ){
		log.T( "setWatchMovingInterval( intervalMsec: "+intervalMsec+" )" );
		var stickObj = this;

		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function doWatchMovingBlinds(){
			log.T( "doWatchMovingBlinds()" );
			for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
				if( stickObj.vnBlinds[i].posCurrent.moving && 
					(!privateCmdQueueHasMsg( stickObj, "blindGetPos", stickObj.vnBlinds[i].snr ) ) ){
					stickObj.vnBlindGetPosition( stickObj.vnBlinds[i].snr, { cmdConfirmation:false, callbackOnUnchangedPos:false } );
				}
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		
		// Clear prevoius position update interval
		if( stickObj.watchMovingIntervalTimer ){
			clearInterval( stickObj.watchMovingIntervalTimer );
			stickObj.watchMovingIntervalTimer = undefined;
			stickObj.watchMovingIntervalMsec = 0;
		}

		// Setup cyclic position update
		if( intervalMsec >= 100 ){
			doWatchMovingBlinds(); // Execute once immediateliy
			stickObj.watchMovingIntervalTimer = setInterval( doWatchMovingBlinds, intervalMsec ); // Execute in interval
			stickObj.watchMovingIntervalMsec = intervalMsec;
			log.I( "Interval for watching moving blinds: "+(intervalMsec)+" ms." );
		}
		else{
			log.I( "Interval for watching moving blinds: cleared." );
		}
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	setPosUpdInterval( intervalMsec ){
		log.T( "setPosUpdInterval( intervalMsec: "+intervalMsec+" )" );
		var stickObj = this;

		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function doPosUpdInterval(){
			log.T( "doPosUpdInterval()" );
			for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
				stickObj.vnBlindGetPosition( stickObj.vnBlinds[i].snr, { cmdConfirmation:false, callbackOnUnchangedPos:false } );
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		
		// Clear prevoius position update interval
		if( stickObj.posUpdIntervalTimer ){
			clearInterval( stickObj.posUpdIntervalTimer );
			stickObj.posUpdIntervalTimer = undefined;
			stickObj.posUpdIntervalMsec = 0;
		}

		// Setup cyclic position update
		if( intervalMsec >= 5000 ){
			doPosUpdInterval(); // Execute once immediateliy
			stickObj.posUpdIntervalTimer = setInterval( doPosUpdInterval, intervalMsec ); // Execute in interval
			stickObj.posUpdIntervalMsec = intervalMsec;
			log.I( "Interval for position update: "+(intervalMsec/1000)+" seconds." );
		}
		else{
			log.I( "Interval for position update: cleared." );
		}
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	setCmdConfirmationNotificationEnabled( enabled ){
		this.enableCmdConfirmationNotification = !! enabled
	}

		// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindSetPosition( id, position, valance ){
		log.T( "vnBlindSetPosition( ("+(typeof id)+") \""+id+"\", "+position+", "+valance+" )" );
		var stickObj = this;
		var blind = stickObj.vnBlindGet( id );

		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function vnBlindSetPositionCompletion( error, wmsMsgSend, wmsMsgRcv ){
			privateHandleWmsCompletionGeneric( error, wmsMsgSend, wmsMsgRcv );
	
			if( this.enableCmdConfirmationNotification ){
				stickObj.callback( error, { topic: "wms-vb-cmd-result-set-position", payload: { error:error, 
					snr: blind.snr, snrHex: blind.snrHex, name: blind.name, 
					position:blind.posRequested.pos, valance:blind.posRequested.val } } );
			}

			if( !error ){
				privateUpdateBlindPosWithCallback( blind, new VnBlindPos( blind.posCurrent.pos, blind.posCurrent.val, true/*moving*/ ), stickObj.callback );
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

		if( blind ){
			blind.posRequested = new VnBlindPos( position, valance, true/*moving*/ );
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "blindMoveToPos", blind.snr, {  pos:position, val:valance } ), vnBlindSetPositionCompletion );
			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else{
			log.W( "vnBlindSetPosition: Cannot find blind \""+id+"\"." );
		}
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindGetPosition( id, optionsPar ){
		log.T( "vnBlindGetPosition( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		const defaultOptions = Object.freeze({ cmdConfirmation:true, callbackOnUnchangedPos:true });
		
		var options = Object.assign({}, defaultOptions, optionsPar );
		
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function vnBlindGetPositionCompletion( error, wmsMsgSend, wmsMsgRcv ){
			privateHandleWmsCompletionGeneric( error, wmsMsgSend, wmsMsgRcv );
	
			if( this.enableCmdConfirmationNotification && options.cmdConfirmation ){
				stickObj.callback( error, { topic: "wms-vb-cmd-result-get-position", payload: { error:error, 
					snr: blind.snr, snrHex: blind.snrHex, name: blind.name } } );
			}
			if( !error ){
				privateUpdateBlindPosWithCallback( 
					blind,
					new VnBlindPos( wmsMsgRcv.params.position, wmsMsgRcv.params.valance, wmsMsgRcv.params.moving ), 
					stickObj.callback, options );
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

		if( !id ){
			for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
				stickObj.vnBlindGetPosition( stickObj.vnBlinds[i].snr );
			}
		}
		else
		{
			var blind = stickObj.vnBlindGet( id );

			if( !blind ){
				log.W( "vnBlindGetPosition: Cannot find blind \""+id+"\"." );
			}
			else
			{
				privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "blindGetPos", blind.snr, {} ), vnBlindGetPositionCompletion );
				setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
			}
		}
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindStop( id, getPosOnStop=true ){
		log.T( "vnBlindStop( ("+(typeof id)+") \""+id+"\" "+getPosOnStop+")" );
		var stickObj = this;
				
		if( !id ){
			// first enqueue all stop commands then all the getPos commands
			for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
				stickObj.vnBlindStop( stickObj.vnBlinds[i].snr, false/*getPosOnStop*/ );
			}
			if( getPosOnStop ){
				for( var i = 0; i < stickObj.vnBlinds.length; i++ ){
					stickObj.vnBlindGetPosition( stickObj.vnBlinds[i].snr );
				}
			}
		}
		else
		{
			var blind = stickObj.vnBlindGet( id );
			
			// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
			function vnBlindStopCompletion( error, wmsMsgSend, wmsMsgRcv ){
				privateHandleWmsCompletionGeneric( error, wmsMsgSend, wmsMsgRcv );

				if( this.enableCmdConfirmationNotification ){
					stickObj.callback( error, { topic: "wms-vb-cmd-result-stop", payload: { error:error, snr: blind.snr, snrHex: blind.snrHex, name: blind.name } } );
				}
			}
			// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

			if( blind ){
				// Before STOP remove allother  pending commands or blind 
				privateCmdQueueRemove( stickObj, null/*msgType*/, blind.snr );
				
				privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "blindStopMove", blind.snr, {} ), vnBlindStopCompletion );
				setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );

				if( getPosOnStop ){
					stickObj.vnBlindGetPosition( blind.snr );
				}
			}
			else{
				log.W( "vnBlindStop: Cannot find blind \""+id+"\"." );
			}
			
		}
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindWaveRequest( id ){
		log.T( "vnBlindWaveRequest( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		
		var blind = stickObj.vnBlindGet( id );
		if( blind ){
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "waveRequest", blind.snr, {} ), privateHandleWmsCompletionGeneric );
			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else{
			log.W( "vnBlindWaveRequest: Cannot find blind \""+id+"\"." );
		}
	}
	
	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindSlatTiltOver( id, diff ){
		log.T( "slatTiltOver( ("+(typeof id)+") \""+id+"\" "+diff+" )" );
		var stickObj = this;
		var blind = stickObj.vnBlindGet( id );
		var newValance = 0;
		
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .
		function vnBlindSlatTiltOverCompletion( error, wmsMsgSend, wmsMsgRcv ){
			privateHandleWmsCompletionGeneric( error, wmsMsgSend, wmsMsgRcv );

			if( !error ){
				if( wmsMsgRcv.msgType === "position" ){
					if( !error ){
						privateUpdateBlindPosWithCallback( blind, 
							new VnBlindPos( wmsMsgRcv.params.position, wmsMsgRcv.params.valance, wmsMsgRcv.params.moving ), 
							stickObj.callback );

						// Positions: -100, -67, -33, 0, 33, 67 , 100
						const stepWidth = 100/3; // 33.33333333333333333333333
						newValance = Math.round( ((Math.round(wmsMsgRcv.params.valance / stepWidth))+diff) * stepWidth );
						newValance = Math.max( newValance, 0 );
						newValance = Math.min( newValance, 100 );


						blind.posRequested = new VnBlindPos( wmsMsgRcv.params.position, newValance, true/*moving*/ );
						privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "blindMoveToPos", blind.snr, 
																		{ pos:blind.posRequested.pos, val:blind.posRequested.val } ), 
																		vnBlindSlatTiltOverCompletion );
						setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
					}
				}
				else{
					privateUpdateBlindPosWithCallback( blind, new VnBlindPos( blind.posCurrent.pos, blind.posCurrent.val, true/*moving*/ ), stickObj.callback );
				}
				
			}
		}
		// . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .

		if( blind ){
			privateCmdQueueEnqueue( stickObj, new wmsUtil.wmsMsgNew( "blindGetPos", blind.snr, {} ), vnBlindSlatTiltOverCompletion );
			setTimeout( function() { privateCmdQueueProcess(stickObj); }, DELAY_MSG_PROC );
		}
		else{
			log.W( "slatTiltOver: Cannot find blind \""+id+"\"." );
		}
		
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindSlatUp( id ){
		log.T( "slatUp( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		stickObj.vnBlindSlatTiltOver( id, -1 );
	}

	// ~ ~ method ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
	vnBlindSlatDown( id ){
		log.T( "slatDown( ("+(typeof id)+") \""+id+"\" )" );
		var stickObj = this;
		stickObj.vnBlindSlatTiltOver( id, 1 );
	}

	
}

//--------------------------------------------------------------------------------------------------
log = wmsUtil.getLogger();

// Export class
module.exports = WmsVbStick;

module.exports.getLogger = getLogger;

//--------------------------------------------------------------------------------------------------
