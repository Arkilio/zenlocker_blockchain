var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("RequestRegistry error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("RequestRegistry error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("RequestRegistry contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of RequestRegistry: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to RequestRegistry.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: RequestRegistry not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "docName",
            "type": "string"
          },
          {
            "name": "sender",
            "type": "address"
          }
        ],
        "name": "requestDocument",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestID",
            "type": "uint256"
          },
          {
            "name": "docID",
            "type": "uint256"
          },
          {
            "name": "docHash",
            "type": "bytes"
          }
        ],
        "name": "grantAccess",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_for",
            "type": "address"
          }
        ],
        "name": "getRequests",
        "outputs": [
          {
            "name": "",
            "type": "uint256[]"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "requestID",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          },
          {
            "name": "_to",
            "type": "address"
          },
          {
            "name": "ipfsHash",
            "type": "bytes"
          },
          {
            "name": "name",
            "type": "string"
          }
        ],
        "name": "sendDocument",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "requestID",
            "type": "uint256"
          }
        ],
        "name": "getRequest",
        "outputs": [
          {
            "name": "sender",
            "type": "address"
          },
          {
            "name": "requester",
            "type": "address"
          },
          {
            "name": "docID",
            "type": "uint256"
          },
          {
            "name": "docIPFSHash",
            "type": "bytes"
          },
          {
            "name": "granted",
            "type": "bool"
          },
          {
            "name": "completed",
            "type": "bool"
          },
          {
            "name": "completedTime",
            "type": "uint256"
          },
          {
            "name": "_requestID",
            "type": "uint256"
          },
          {
            "name": "docName",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "docRegistryAddress",
            "type": "address"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentRequested",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          }
        ],
        "name": "AccessGranted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "issuer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAttested",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x60606040819052600180556020806112ec833950608060405251600080546c0100000000000000000000000080840204600160a060020a03199091161790555061129f8061004d6000396000f3606060405236156100565760e060020a60003504630fa70f21811461005b5780636899d34514610140578063804e44f31461021a5780638f7792011461029a578063bb865103146102a8578063c58343ef146103c2575b610002565b34610002576104626004808035906020019082018035906020019191908080601f01602080910402602001604051908101604052809392919081815260200183838082843750949650509335935050505060018054600090815260026020818152604083208085018054606060020a80890204600160a060020a031990911617905586516007820180548187529584902092969095601f9181161561010002600019011694909404840183900482019390928801908390106105d457805160ff19168380011785555b506106049291505b808211156106d6576000815560010161012c565b3461000257604080516020600460443581810135601f810184900484028501840190955284845261046294823594602480359560649492939190920191819084018382808284375094965050505050505060006000836000600060009054906101000a9004600160a060020a0316600160a060020a03166307b31818836000604051602001526040518260e060020a02815260040180828152602001915050602060405180830381600087803b156100025760325a03f11561000257505060405151915050600160a060020a03811615156108d757610002565b346100025761046460043560408051602081810183526000808352600160a060020a0385168152600382528390208054845181840281018401909552808552929392909183018282801561028e57602002820191906000526020600020905b81548152600190910190602001808311610279575b50505050509050919050565b34610002576104ae60015481565b3461000257604080516020600460443581810135601f8101849004840285018401909552848452610462948235946024803595606494929391909201918190840183828082843750506040805160209735808a0135601f81018a90048a0283018a01909352828252969897608497919650602491909101945090925082915084018382808284375094965050505050505060006000856000600060009054906101000a9004600160a060020a0316600160a060020a03166307b31818836000604051602001526040518260e060020a02815260040180828152602001915050602060405180830381600087803b156100025760325a03f11561000257505060405151915050600160a060020a0381161515610c8857610002565b34610002576104c060043560408051602081810183526000808352835180830185528181528582526002808452858320808201546003820180548951601f6000196101006001851615020190921695909504908101889004880285018801909952888452949788979196919588958695869586959294909391928301828280156111705780601f1061114557610100808354040283529160200191611170565b005b60405180806020018281038252838181518152602001915080519060200190602002808383829060006004602084601f0104600302600f01f1509050019250505060405180910390f35b60408051918252519081900360200190f35b604051808a600160a060020a0316815260200189600160a060020a031681526020018881526020018060200187151581526020018615158152602001858152602001848152602001806020018381038352898181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156105645780820380516001836020036101000a031916815260200191505b508381038252848181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156105bd5780820380516001836020036101000a031916815260200191505b509b50505050505050505050505060405180910390f35b82800160010185558215610124579182015b828111156101245782518260005055916020019190600101906105e6565b50508054600160a060020a0319908116606060020a33810281900491909117808455426005850155600180546000908152600260208181526040832080548816600160a060020a03968716880288900417815584890154818601805490991696168702969096049490941790955584860154848601556003808701805491860180548185529386902089989196610100868816158102600019908101909716849004601f908101929092048301978616150290950190931604928390106106da57805485555b5061071692915061012c565b5090565b828001600101855582156106ca57600052602060002091601f016020900482015b828111156106ca5782548255916001019190600101906106fb565b505060048281018054918301805460f860020a60ff948516810281900460ff1990921691909117808355925461010090819004909416810204830261ff0019909216919091179055600580840154908301556006808401549083015560078084018054918401805460008281526020908190209295601f60026001858116158402600019908101909616829004830194909404860197938416159092029093019091160492908390106107d457805485555b5061081092915061012c565b828001600101855582156107c857600052602060002091601f016020900482015b828111156107c85782548255916001019190600101906107f5565b505050600160a060020a033316600090815260036020526040902080546001810180835591925090828183801582901161085b5760008381526020902061085b91810190830161012c565b5050506000928352506020808320600180549190930155600160a060020a0385168352600390526040909120805491820180825590919082818380158290116108b5576000838152602090206108b591810190830161012c565b5050506000928352506020909120600180549190920181905581019055505050565b600087815260026020908152604080832083548251840185905282517f07b31818000000000000000000000000000000000000000000000000000000008152600481018c90529251919850600160a060020a0316936307b3181893602480850194919392918390030190829087803b156100025760325a03f1156100025750506040515193505033600160a060020a039081169084161461097757610002565b600184015433600160a060020a0390811691161461099457610002565b600484018054610100600160ff19909216821761ff0019168117909255426006870155865160038701805460008281526020908190209295600295831615026000190190911693909304601f9081018490048201938a0190839010610a0c57805160ff19168380011785555b50610a3c92915061012c565b82800160010185558215610a00579182015b82811115610a00578251826000505591602001919060010190610a1e565b50506002808501878155600089815260208381526040822088548154606060020a600160a060020a039283168102819004600160a060020a03199283161784556001808d015481860180549190951683029290920491909216179091559354818601556003808a0180549183018054818752958590208c9894979196601f8184161561010090810260001990810190931688900482019890980483019793861615909302019093169390930492839010610b0157805485555b50610b3d92915061012c565b82800160010185558215610af557600052602060002091601f016020900482015b82811115610af5578254825591600101919060010190610b22565b505060048281018054918301805460f860020a60ff948516810281900460ff1990921691909117808355925461010090819004909416810204830261ff0019909216919091179055600580840154908301556006808401549083015560078084018054918401805460008281526020908190209295601f6002600185811615840260001990810190961682900483019490940486019793841615909202909301909116049290839010610bfb57805485555b50610c3792915061012c565b82800160010185558215610bef57600052602060002091601f016020900482015b82811115610bef578254825591600101919060010190610c1c565b505060408051600160a060020a0333168152602081018b905281517fb4c6779ceb4a20f448e76a0e11f39bd183cff9c9dbac53df6bfcc202e2eb32f19450908190039091019150a150505050505050565b600060009054906101000a9004600160a060020a0316600160a060020a03166307b31818896000604051602001526040518260e060020a02815260040180828152602001915050602060405180830381600087803b156100025760325a03f1156100025750506040515194505033600160a060020a0390811690851614610d0e57610002565b600180548101808255600090815260026020818152604083208083018d90558054606060020a808e02819004600160a060020a0319928316178355426005840155828701805433830292909204919092161790558a516003820180548187529584902092995095601f90861615610100026000190190951693909304840182900481019390918b0190839010610db757805160ff19168380011785555b50610de792915061012c565b82800160010185558215610dab579182015b82811115610dab578251826000505591602001919060010190610dc9565b505060048301805461ff001916610100908117909155855160078501805460008281526020908190209294601f60026000196001861615909302929092019093160482018190048301939291908a0190839010610e5757805160ff19168380011785555b50610e8792915061012c565b82800160010185558215610e4b579182015b82811115610e4b578251826000505591602001919060010190610e69565b5050426006840155600180546000908152600260208181526040832087548154606060020a600160a060020a039283168102819004600160a060020a0319928316178455878b015484890180549190941682029190910491161790558288015481840155600380890180549183018054818852968590208b9894979196601f83871615610100908102600019908101909516839004820198909804830197968616159096029092019093160492839010610f4c57805485555b50610f8892915061012c565b82800160010185558215610f4057600052602060002091601f016020900482015b82811115610f40578254825591600101919060010190610f6d565b505060048281018054918301805460f860020a60ff948516810281900460ff1990921691909117808355925461010090819004909416810204830261ff0019909216919091179055600580840154908301556006808401549083015560078084018054918401805460008281526020908190209295601f600260018581161584026000199081019096168290048301949094048601979384161590920290930190911604929083901061104657805485555b5061108292915061012c565b8280016001018555821561103a57600052602060002091601f016020900482015b8281111561103a578254825591600101919060010190611067565b505050600160a060020a03331660009081526003602052604090208054600181018083559192509082818380158290116110cd576000838152602090206110cd91810190830161012c565b5050506000928352506020808320600180549190930155600160a060020a038a168352600390526040909120805491820180825590919082818380158290116111275760008381526020902061112791810190830161012c565b50505060009283525060209091206001549101555050505050505050565b820191906000526020600020905b81548152906001019060200180831161115357829003601f168201915b5050505050965086508060040160009054906101000a900460ff16955085508060000160009054906101000a9004600160a060020a0316985088508060010160009054906101000a9004600160a060020a0316995089508a925082508060060160005054935083508060040160019054906101000a900460ff1694508450806007016000508054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156112895780601f1061125e57610100808354040283529160200191611289565b820191906000526020600020905b81548152906001019060200180831161126c57829003601f168201915b509395505050505050919395979990929496985056",
    "events": {
      "0x674f4969d8487d6f8264447675cc44cdc40f7c3033ccdfc887ad40a24453c60f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentRequested",
        "type": "event"
      },
      "0xb4c6779ceb4a20f448e76a0e11f39bd183cff9c9dbac53df6bfcc202e2eb32f1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          }
        ],
        "name": "AccessGranted",
        "type": "event"
      },
      "0x32c94573316078c697563d687b7649946914fd68c26bf5f9aa92c5e867801c98": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "issuer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "requestID",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAttested",
        "type": "event"
      }
    },
    "updated_at": 1483913741763,
    "links": {},
    "address": "0x8a9fe1d5972e4117c424d74897621b0308c12996"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "RequestRegistry";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.RequestRegistry = Contract;
  }
})();
